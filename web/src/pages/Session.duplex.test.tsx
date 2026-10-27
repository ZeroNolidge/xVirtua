import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientChunk } from '@plainspeak/shared';
import type { TurnInput } from '../lib/session';

vi.mock('../lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
  storage: {},
  usingEmulators: true,
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
}));
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  uploadBytesResumable: vi.fn(),
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ claims: { role: 'resident', programId: 'irmc' }, user: { uid: 'u1' } }),
}));
vi.mock('../components/PlainWordSearch', () => ({ PlainWordSearch: () => null }));
vi.mock('../lib/recorder', () => ({
  SessionRecorder: class {
    ext = 'webm';
    start() {}
    pause() {}
    resume() {}
    async stop() {
      return null;
    }
  },
}));

// Fake speech-to-text: the test drives its callbacks.
type Cb = {
  onSpeechStart(): void;
  onPartial(t: string, startedAt?: number): void;
  onFinal(t: string, startedAt?: number): void;
};
let stt: Cb;
vi.mock('../lib/stt', () => ({
  OpenAIRealtimeStt: class {
    constructor(cb: Cb) {
      stt = cb;
    }
    async start() {}
    setMuted() {}
    stop() {}
  },
}));

const calls: TurnInput[] = [];
let hold: Promise<void> | null = null;
const reply = (idx: number, text: string) => ({
  patient: {
    idx,
    text,
    askedQuestion: true,
    delivery: { emotion: 'worried', volume: 'normal', rate: 'normal', pauseBeforeMs: 0 },
    nonverbal: [],
  },
  latencyMs: 5,
});
vi.mock('../lib/session', () => ({
  sessionApi: {
    saveHeard: vi.fn(async () => ({ data: { ok: true } })),
    end: vi.fn(async () => ({ data: {} })),
    sttToken: vi.fn(async () => ({ data: { value: 'ek_test', turnDetection: 'semantic' } })),
  },
  streamTurn: async (input: TurnInput, onChunk: (c: PatientChunk) => void) => {
    calls.push(input);
    if (hold) await hold;
    const text =
      calls.length === 1
        ? 'Will I lose my license? I drive a truck for a living.'
        : 'Okay, go ahead.';
    onChunk({ t: 'say', seq: 0, text: text.split('? ')[0] + (text.includes('?') ? '?' : '') });
    if (text.includes('? ')) onChunk({ t: 'say', seq: 1, text: text.split('? ')[1]! });
    return reply(calls.length * 2, text);
  },
  fetchPatientAudio: vi.fn(async () => null),
  audioFromChunk: vi.fn(),
}));

// Playback: the opening line plays instantly; patient replies keep playing
// (sentence by sentence) until stopped, so the test can talk over them.
let releaseClip: (() => void) | null = null;
vi.mock('../lib/voiceRenderer', async (orig) => {
  const m = await orig<typeof import('../lib/voiceRenderer')>();
  class TestRenderer extends m.VoiceRenderer {
    override async mount() {}
    override async play(_b: Blob | null, text: string) {
      if (text.startsWith('So, my blood pressure')) return;
      await new Promise<void>((r) => (releaseClip = r));
    }
    override stopClip() {
      releaseClip?.();
    }
    override duck() {}
  }
  return { ...m, VoiceRenderer: TestRenderer };
});

const { Session } = await import('./Session');

const opening = {
  idx: 0,
  text: 'So, my blood pressure is high?',
  askedQuestion: true,
  delivery: { emotion: 'neutral', volume: 'normal', rate: 'normal', pauseBeforeMs: 0 },
  nonverbal: [],
} as const;

async function start() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
  Element.prototype.scrollIntoView = () => {};
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/session/s1',
          state: { opening, persona: { name: 'Ray Kowalski', age: 58, pronouns: 'he/him' } },
        },
      ]}
    >
      <Routes>
        <Route path="/session/:id" element={<Session />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));
  });
  await screen.findByText(opening.text);
}

const say = async (t: string) =>
  act(async () => {
    stt.onSpeechStart();
    stt.onPartial(t);
    stt.onFinal(t);
  });

beforeEach(() => {
  calls.length = 0;
  hold = null;
});

describe('two-way voice', () => {
  it('stops the patient mid-reply when the resident talks over him, and tells the server what was heard', async () => {
    await start();
    await say('Your blood pressure is high, so we should treat it.');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 5000 });
    await screen.findByText('Will I lose my license?', undefined, { timeout: 4000 });

    // His own words coming back through the mic are ignored (echo)...
    await act(async () => stt.onPartial('will I lose my license'));
    expect(screen.getByText('Will I lose my license?')).toBeInTheDocument();

    // ...but the resident talking over him (a few seconds in) stops him.
    const realNow = performance.now.bind(performance);
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + 3000);
    await say('Wait, before you go on, can I ask about your job?');
    spy.mockRestore();
    expect(
      await screen.findByText('Will I lose my license? —', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5000 });
    expect(calls[1]!.prevInterrupted).toEqual({ heard: 'Will I lose my license?' });
    expect(calls[1]!.text).toBe('Wait, before you go on, can I ask about your job?');
  });

  it('a “mm-hm” over the patient is listening, not cutting him off', async () => {
    await start();
    await say('Your blood pressure is high, so we should treat it.');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 5000 });
    await screen.findByText('Will I lose my license?', undefined, { timeout: 4000 });
    const realNow = performance.now.bind(performance);
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + 3000);
    await say('Mm-hm.');
    spy.mockRestore();
    expect(screen.queryByText('Will I lose my license? —')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('the late second half of what the resident said is never a cut-in, even seconds later', async () => {
    await start();
    // The resident keeps talking; the speech service splits it in two.
    const secondHalfStarted = performance.now();
    await say('I’m glad you feel fine,');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 5000 });
    await screen.findByText('Will I lose my license?', undefined, { timeout: 4000 });
    // Its words only arrive 3s into the reply, but that speech began before he did.
    const realNow = performance.now.bind(performance);
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + 3000);
    await act(async () => {
      stt.onPartial('but we are still worried about your pressure', secondHalfStarted);
      stt.onFinal('but we are still worried about your pressure', secondHalfStarted);
    });
    spy.mockRestore();
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5000 });
    expect(calls[1]!.supersedes).toBe(1);
    expect(calls[1]!.prevInterrupted).toBeUndefined();
    expect(screen.queryByText(/Will I lose my license\? —/)).toBeNull();
  });

  it('replaces a reply that has not played yet when the resident keeps talking', async () => {
    await start();
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    await say('That’s understandable.');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 5000 });
    // Still thinking: the resident goes on.
    await say('I’m sorry about your dad.');
    hold = null;
    await act(async () => release());
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5000 });
    expect(calls[1]!.supersedes).toBe(1);
    expect(calls[1]!.text).toBe('That’s understandable. I’m sorry about your dad.');
    // The unplayed first reply never appears.
    expect(screen.queryByText(/I drive a truck/)).toBeNull();
  });

  it('treats talking again right as the patient starts as finishing a thought, not interrupting', async () => {
    await start();
    await say('I’m glad you feel fine, but we are still worried about your blood pressure.');
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 5000 });
    await screen.findByText('Will I lose my license?', undefined, { timeout: 4000 });
    // A second later the resident carries on with their thought.
    await say('Because high blood pressure can still cause some health issues.');
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5000 });
    expect(calls[1]!.supersedes).toBe(1);
    expect(calls[1]!.prevInterrupted).toBeUndefined();
    expect(calls[1]!.text).toBe(
      'I’m glad you feel fine, but we are still worried about your blood pressure. Because high blood pressure can still cause some health issues.',
    );
    expect(screen.queryByText(/Will I lose my license\? —/)).toBeNull();
  });

  it('fetches the reply as soon as the words are in, but plays it only after the end-of-turn wait', async () => {
    await start();
    await say('We will check your blood pressure again next month.');
    // Asked for at once...
    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 300 });
    // ...but not played yet: the resident might still be carrying on.
    expect(screen.queryByText('Will I lose my license?')).toBeNull();
    expect(
      await screen.findByText('Will I lose my license?', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });
});
