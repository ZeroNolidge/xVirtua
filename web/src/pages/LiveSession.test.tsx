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
let micLoudMs = 0;
let micLoudAt = -1e9;
let lastSound = -1e9;
const ducked: boolean[] = [];
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
      get lastSoundAt() {
        return audible ? performance.now() : lastSound;
      }
      get lastMicLoudAt() {
        return micLoudAt;
      }
      patientAudible() {
        return audible;
      }
      truncate() {
        return false;
      }
      micLoudFor() {
        return micLoudMs;
      }
      duckPatient(on: boolean) {
        ducked.push(on);
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
    saveHeard: vi.fn(async () => ({ data: { ok: true } })),
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

const { sessionApi } = await import('../lib/session');
const saved = () =>
  (
    sessionApi.saveHeard as unknown as { mock: { calls: [Record<string, unknown>][] } }
  ).mock.calls.map((c) => c[0]);
const sleep = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  calls.length = 0;
  said.length = 0;
  muted.length = 0;
  ducked.length = 0;
  audible = false;
  failConnect = false;
  micLoudMs = 0;
  micLoudAt = -1e9;
  lastSound = -1e9;
  vi.mocked(sessionApi.saveHeard).mockClear();
});

/** The resident says something and GPT-Live asks for the reply. */
async function residentTurn(text: string, id: string) {
  micLoudAt = performance.now();
  await act(async () => cb.onHeard(text));
  await act(async () => cb.onDelegation(id));
}

/** Ray stops talking (his voice goes quiet). */
function patientStops() {
  audible = false;
  lastSound = performance.now();
}

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
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 4000 });
    expect(calls[0]).toMatchObject({
      text: 'Yes, it is a bit high, but we can treat it.',
      live: true,
    });
    expect(said.slice(1)).toEqual([
      ['del_1', '[worried, quiet] Will I lose my license?'],
      ['del_1', 'I drive a truck.'],
    ]);
    expect(await screen.findByText('Will I lose my license? I drive a truck.')).toBeInTheDocument();
  });

  it('waits for the resident’s last words before asking Claude', async () => {
    await start();
    await act(async () => cb.onStarted());
    await act(async () => cb.onHeard('So the plan is'));
    await act(async () => cb.onDelegation('del_1'));
    // The rest of the sentence lands a moment after GPT-Live asked.
    await sleep(400);
    await act(async () => cb.onHeard(' to start a small pill.'));
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 4000 });
    expect(calls[0]!.text).toBe('So the plan is to start a small pill.');
  });

  it('adds words that arrive after the reply was asked for to that same turn, not the next', async () => {
    await start();
    await act(async () => cb.onStarted());
    await residentTurn('We will check it again next month', 'del_1');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 4000 });
    // Ray hasn't started talking yet; the last words come in late.
    await act(async () => cb.onHeard(' at your follow-up.'));
    expect(
      screen.getByText('We will check it again next month at your follow-up.'),
    ).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(saved()).toContainEqual({
        sessionId: 's1',
        idx: 2,
        residentAppend: 'at your follow-up.',
      }),
    );
    // They don't spill into the next turn.
    await sleep(2600);
    await residentTurn('Any questions?', 'del_2');
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 4000 });
    expect(calls[1]!.text).toBe('Any questions?');
  });

  it('saves what Ray actually said out loud once he’s done, not the planned line', async () => {
    await start();
    await act(async () => cb.onStarted());
    await residentTurn('Let me explain.', 'del_1');
    await screen.findByText('Will I lose my license? I drive a truck.');
    audible = true;
    await act(async () => {
      cb.onSpoken('Am I gonna lose my license? ', 0);
      cb.onSpoken('I drive trucks.', 1500);
    });
    await sleep(100);
    patientStops();
    await sleep(1100);
    expect(saved()).toContainEqual({
      sessionId: 's1',
      idx: 2,
      spoken: 'Am I gonna lose my license? I drive trucks.',
    });
    expect(screen.getByText('Am I gonna lose my license? I drive trucks.')).toBeInTheDocument();
  });

  it('on a cut-off, keeps only the words Ray got out and saves them at once', async () => {
    await start();
    await act(async () => cb.onStarted());
    await residentTurn('Let me explain.', 'del_1');
    await screen.findByText('Will I lose my license? I drive a truck.');

    // GPT-Live's transcript runs ahead of his voice.
    audible = true;
    await act(async () => {
      cb.onSpoken('Will ', 0);
      cb.onSpoken('I ', 300);
      cb.onSpoken('lose ', 600);
      cb.onSpoken('my license? ', 1000);
      cb.onSpoken('I drive a truck.', 2000);
    });
    await sleep(800);
    // His own words in the mic don't count...
    await act(async () => cb.onHeard('will I lose'));
    expect(muted).toEqual([]);
    // ...but the resident talking over him does.
    micLoudAt = performance.now();
    await act(async () => cb.onHeard(' no wait, can I ask about your job first?'));
    expect(muted[0]).toBe(true);
    expect(screen.getByText('Will I lose —')).toBeInTheDocument();
    expect(saved()).toContainEqual({ sessionId: 's1', idx: 2, cutOff: { heard: 'Will I lose' } });

    patientStops();
    await act(async () => cb.onDelegation('del_2'));
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 4000 });
    expect(calls[1]!.text).toBe('no wait, can I ask about your job first?');
    // Already saved: not sent again.
    expect(calls[1]!.prevInterrupted).toBeUndefined();
  });

  it('ignores Ray’s own echo just after he stops talking', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(100);
    patientStops();
    await act(async () => cb.onHeard('my blood pressure is high'));
    await act(async () => cb.onDelegation('del_1'));
    await sleep(1700);
    expect(calls).toHaveLength(0);
    // The resident's own reply right after still counts.
    await residentTurn('Yes, a little. Let’s talk about it.', 'del_2');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 4000 });
    expect(calls[0]!.text).toBe('Yes, a little. Let’s talk about it.');
  });

  it('turns the patient down as soon as the mic hears the resident, and back up if it wasn’t them', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my ', 0));
    micLoudMs = 200;
    await sleep(120);
    expect(ducked).toEqual([true]);
    micLoudMs = 0;
    await sleep(1600);
    expect(ducked).toEqual([true, false]);
    expect(muted).toEqual([]);
  });

  it('falls back to the standard voice when GPT-Live can’t connect', async () => {
    failConnect = true;
    const onFallback = await start();
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
    expect(onFallback.mock.calls[0]![0]).toMatch(/standard voice/);
    expect(onFallback.mock.calls[0]![1]).toBeNull();
  });
});
