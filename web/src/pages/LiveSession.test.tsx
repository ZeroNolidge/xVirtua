import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientChunk } from '@plainspeak/shared';
import type { TurnInput, Utterance } from '../lib/session';
import type { LiveCallbacks } from '../lib/liveVoice';

vi.mock('../lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
  storage: {},
  usingEmulators: true,
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn() }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ claims: { role: 'resident', programId: 'irmc' }, user: { uid: 'u1' } }),
}));
vi.mock('../lib/errorReport', () => ({ reportError: vi.fn() }));
vi.mock('../components/PlainWordSearch', () => ({ PlainWordSearch: () => null }));
vi.mock('../lib/recorder', () => ({
  SessionRecorder: class {
    ext = 'webm';
    start() {}
    async stop() {
      return null;
    }
  },
}));

// Fake GPT-Live call: the test drives its events.
let cb: LiveCallbacks;
let audible = false;
let failConnect = false;
const said: [string | null, string][] = [];
const muted: boolean[] = [];
vi.mock('../lib/liveVoice', async (orig) => {
  const m = await orig<typeof import('../lib/liveVoice')>();
  return {
    ...m,
    LiveVoiceCall: class {
      constructor(c: LiveCallbacks) {
        cb = c;
      }
      unlockAudio() {}
      async start(_mic: MediaStream, connect: (sdp: string) => Promise<string>) {
        await connect('v=0 offer');
      }
      patientAudible() {
        return audible;
      }
      mutePatient(m: boolean) {
        muted.push(m);
      }
      say(id: string | null, text: string) {
        said.push([id, text]);
        return true;
      }
      note() {
        return true;
      }
      async close() {}
      hangUp() {}
    },
  };
});

const calls: TurnInput[] = [];
vi.mock('../lib/session', () => ({
  sessionApi: {
    end: vi.fn(async () => ({ data: {} })),
    startLiveCall: vi.fn(async () => {
      if (failConnect) throw new Error('unavailable');
      return { data: { sdp: 'v=0 answer', voice: 'cinder' } };
    }),
  },
  streamTurn: async (input: TurnInput, onChunk: (c: PatientChunk) => void) => {
    calls.push(input);
    onChunk({
      t: 'meta',
      delivery: { emotion: 'worried', volume: 'quiet', rate: 'normal', pauseBeforeMs: 0 },
      nonverbal: [],
    });
    onChunk({ t: 'say', seq: 0, text: 'Will I lose my license?' });
    onChunk({ t: 'say', seq: 1, text: 'I drive a truck.' });
    return {
      patient: {
        idx: calls.length * 2,
        text: 'Will I lose my license? I drive a truck.',
        askedQuestion: true,
        delivery: { emotion: 'worried', volume: 'quiet', rate: 'normal', pauseBeforeMs: 0 },
        nonverbal: [],
      },
      latencyMs: 5,
    };
  },
}));

const { LiveConversation } = await import('./LiveSession');

const opening: Utterance = {
  idx: 0,
  text: 'So, my blood pressure is high?',
  askedQuestion: true,
  delivery: { emotion: 'neutral', volume: 'normal', rate: 'normal', pauseBeforeMs: 0 },
  nonverbal: [],
};

async function start(onFallback = vi.fn()) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
  Element.prototype.scrollIntoView = () => {};
  render(
    <MemoryRouter>
      <LiveConversation
        sessionId="s1"
        persona={{ name: 'Ray Kowalski', age: 58, pronouns: 'he/him' }}
        opening={opening}
        onFallback={onFallback}
      />
    </MemoryRouter>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));
  });
  return onFallback;
}

beforeEach(() => {
  calls.length = 0;
  said.length = 0;
  muted.length = 0;
  audible = false;
  failConnect = false;
});

describe('GPT-Live conversation', () => {
  it('has GPT-Live say the opening line, then answers each request with Claude’s words and tone', async () => {
    await start();
    await act(async () => cb.onStarted());
    expect(said[0]).toEqual([null, 'So, my blood pressure is high?']);
    expect(screen.getByText(opening.text)).toBeInTheDocument();

    await act(async () => {
      cb.onHeard('Yes, it is a bit high, ');
      cb.onHeard('but we can treat it.');
    });
    await act(async () => cb.onDelegation('del_1'));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      text: 'Yes, it is a bit high, but we can treat it.',
      live: true,
    });
    expect(said.slice(1)).toEqual([
      ['del_1', '[worried, quiet] Will I lose my license?'],
      ['del_1', 'I drive a truck.'],
    ]);
    expect(await screen.findByText('Will I lose my license? I drive a truck.')).toBeInTheDocument();
    expect(screen.getByText('Yes, it is a bit high, but we can treat it.')).toBeInTheDocument();
  });

  it('cuts the patient off when the resident keeps talking over him, and tells the server what was heard', async () => {
    await start();
    await act(async () => cb.onStarted());
    await act(async () => cb.onHeard('Let me explain.'));
    await act(async () => cb.onDelegation('del_1'));
    await screen.findByText('Will I lose my license? I drive a truck.');

    // He's talking...
    audible = true;
    await act(async () => cb.onSpoken('Will I lose my '));
    // ...his own words in the mic don't count...
    await act(async () => cb.onHeard('will I lose'));
    await new Promise((r) => setTimeout(r, 300));
    expect(muted).toEqual([]);
    // ...but the resident talking on does.
    await act(async () => cb.onHeard(' No wait, can I ask about your job first?'));
    await act(async () => cb.onHeard(' What kind of trucks?'));
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(muted[0]).toBe(true);
    expect(await screen.findByText('Will I lose my —')).toBeInTheDocument();

    audible = false;
    await act(async () => cb.onDelegation('del_2'));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.prevInterrupted).toEqual({ heard: 'Will I lose my' });
    expect(calls[1]!.prevSpoken).toBe('Will I lose my');
  });

  it('falls back to the standard voice when GPT-Live can’t connect', async () => {
    failConnect = true;
    const onFallback = await start();
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
    expect(onFallback.mock.calls[0]![0]).toMatch(/standard voice/);
    expect(onFallback.mock.calls[0]![1]).toBeNull();
  });
});
