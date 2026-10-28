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
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  uploadBytesResumable: vi.fn(),
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ claims: { role: 'resident', programId: 'irmc' }, user: { uid: 'u1' } }),
}));
vi.mock('../lib/errorReport', () => ({ reportError: vi.fn() }));
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

// Fake GPT-Live call: the test drives its events.
let cb: LiveCallbacks;
let audible = false;
let micLoudMs = 0;
let micLoudAt = -1e9;
let lastSound = -1e9;
let nudges = 0;
let micsOpened = 0;
let micsStopped = 0;
let closes = 0;
const ducked: boolean[] = [];
let failConnect = false;
const said: [string | null, string][] = [];
const muted: boolean[] = [];
const notes: string[] = [];
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
      nudge() {
        nudges++;
        return true;
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
      note(_id: string | null, text: string) {
        notes.push(text);
        return true;
      }
      async close() {
        closes++;
      }
      hangUp() {}
    },
  };
});

const calls: TurnInput[] = [];
vi.mock('../lib/session', () => ({
  sessionApi: {
    saveHeard: vi.fn(async () => ({ data: { ok: true } })),
    saveLiveExchange: vi.fn(async () => ({
      data: {
        residentIdx: 1,
        patientIdx: 2,
        note: 'If asked about other worries, bring up your license.',
      },
    })),
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
    value: {
      getUserMedia: async () => {
        micsOpened++;
        return { getTracks: () => [{ stop: () => micsStopped++ }] };
      },
    },
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
  notes.length = 0;
  muted.length = 0;
  ducked.length = 0;
  audible = false;
  failConnect = false;
  micLoudMs = 0;
  micLoudAt = -1e9;
  lastSound = -1e9;
  vi.mocked(sessionApi.saveHeard).mockClear();
  vi.mocked(sessionApi.saveLiveExchange).mockClear();
});

/** The resident says something and GPT-Live asks for the reply. */
async function residentTurn(text: string, id: string) {
  micLoudAt = performance.now();
  await act(async () => cb.onHeard(text));
  await act(async () => cb.onDelegation(id));
}

/** Waits until Ray's line has gone out to GPT-Live. */
async function lineSent(n: number) {
  await vi.waitFor(() => expect(said.filter(([id]) => id !== null)).toHaveLength(n), {
    timeout: 4000,
  });
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
    // A moment of silence gets GPT-Live talking, and the screen says Ray is getting ready.
    expect(nudges).toBeGreaterThan(0);
    expect(screen.getByText('Ray is getting ready…')).toBeInTheDocument();
    // Nothing shows until he says it, then his words appear as he speaks.
    expect(screen.queryByText(opening.text)).toBeNull();
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(120);
    expect(screen.getByText(opening.text)).toBeInTheDocument();
    patientStops();

    micLoudAt = performance.now();
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
    // The whole line goes out at once.
    await vi.waitFor(() =>
      expect(said.slice(1)).toEqual([
        ['del_1', '[worried, quiet] Will I lose my license? I drive a truck.'],
      ]),
    );
    expect(screen.queryByText(/Will I lose my license/)).toBeNull();
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
    await lineSent(1);
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
    await lineSent(1);

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

  it('a “mm-hm” while Ray talks doesn’t cut him off', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high? ', 0));
    await sleep(120);
    micLoudAt = performance.now();
    await act(async () => cb.onHeard('Mm-hm.'));
    await act(async () => cb.onHeard(' Right.'));
    expect(muted).toEqual([]);
    expect(saved().some((x) => 'cutOff' in x)).toBe(false);
  });

  it('after a cut-off, keeps Ray muted until GPT-Live has stopped the old line', async () => {
    await start();
    await act(async () => cb.onStarted());
    await residentTurn('Let me explain.', 'del_1');
    await lineSent(1);
    audible = true;
    await act(async () => cb.onSpoken('Will I lose my license? ', 0));
    await sleep(300);
    micLoudAt = performance.now();
    await act(async () => cb.onHeard('Hold on, what do you do for work?'));
    expect(muted).toEqual([true]);
    // GPT-Live keeps going with the old line, with a pause between sentences.
    await act(async () => cb.onSpoken('I drive a truck. ', 1500));
    audible = false;
    lastSound = performance.now();
    await sleep(700);
    expect(muted).toEqual([true]);
    // Then it really stops.
    await sleep(1000);
    expect(muted).toEqual([true, false]);
  });

  it('when GPT-Live answers on its own, shows both sides and saves the exchange', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(100);
    patientStops();
    await sleep(1000);
    // The resident answers; GPT-Live replies without asking us.
    micLoudAt = performance.now();
    await act(async () => cb.onHeard('Yes, a little, but we can treat it.'));
    await sleep(1600);
    audible = true;
    await act(async () => cb.onSpoken('Okay. Is that bad?', 5000));
    await sleep(120);
    expect(screen.getByText('Yes, a little, but we can treat it.')).toBeInTheDocument();
    expect(screen.getByText('Okay. Is that bad?')).toBeInTheDocument();
    patientStops();
    await sleep(1800);
    expect(sessionApi.saveLiveExchange).toHaveBeenCalledWith({
      sessionId: 's1',
      resident: 'Yes, a little, but we can treat it.',
      patient: 'Okay. Is that bad?',
    });
    expect(calls).toHaveLength(0);
    // Claude's note steers the next reply, privately.
    await vi.waitFor(() =>
      expect(
        notes.some((n) => n.includes('bring up your license') && n.includes('never say it aloud')),
      ).toBe(true),
    );
  }, 10_000);

  it('hides the words by default (captions off), and the Captions button brings them back and is remembered', async () => {
    window.localStorage.removeItem('plainspeak.captions');
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(300);
    expect(screen.queryByText(opening.text)).toBeNull();
    expect(screen.getByText(/Captions are off/)).toBeInTheDocument();
    expect(screen.getByText('Ray is talking…')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Captions: off' }));
    });
    expect(screen.getByText(opening.text)).toBeInTheDocument();
    expect(window.localStorage.getItem('plainspeak.captions')).toBe('on');
    // End is a quiet button that asks first.
    expect(screen.getByRole('button', { name: 'End' })).toHaveClass('btn-outline');
  });

  it('turns the mic and the call off when the app is hidden, and picks up again on Continue', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(100);
    patientStops();
    const opened = micsOpened;
    const stopped = micsStopped;
    const closed = closes;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(micsStopped).toBe(stopped + 1);
    expect(closes).toBe(closed + 1);
    expect(screen.getByText(/Paused\. The mic is off\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue the conversation/i }));
    });
    expect(micsOpened).toBe(opened + 1);
    await act(async () => cb.onStarted());
    // Ray doesn't start over: no second opening line, just a private recap.
    expect(said.filter(([, t]) => t.includes('my blood pressure is high'))).toHaveLength(1);
    expect(notes.some((n) => n.includes('picking up after a break'))).toBe(true);
    expect(screen.getByText('Your turn — just talk')).toBeInTheDocument();
  });

  it('says so when Ray’s words arrive but no sound plays (e.g. Bluetooth took it)', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = false;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(3800);
    expect(screen.getByText(/Can’t hear Ray\?/)).toBeInTheDocument();
    expect(screen.getByText('So, my blood pressure is high?')).toBeInTheDocument();
    expect(screen.queryByText('Ray is thinking…')).toBeNull();
  }, 10_000);

  it('when Ray pauses mid-answer and goes on, it stays one bubble and one saved turn', async () => {
    await start();
    await act(async () => cb.onStarted());
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(100);
    patientStops();
    await sleep(1000);
    micLoudAt = performance.now();
    await act(async () => cb.onHeard('You seem a little hesitant.'));
    await sleep(1600);
    audible = true;
    await act(async () => cb.onSpoken('Yeah, a little. I just...', 5000));
    await sleep(120);
    patientStops();
    // A long, thoughtful pause, then he goes on.
    await sleep(2000);
    audible = true;
    await act(async () => cb.onSpoken('I don\u2019t wanna end up like my dad.', 9000));
    await sleep(120);
    patientStops();
    await sleep(1800);
    expect(sessionApi.saveLiveExchange).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('Yeah, a little. I just... I don\u2019t wanna end up like my dad.'),
    ).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(saved()).toContainEqual({
        sessionId: 's1',
        idx: 2,
        spoken: 'Yeah, a little. I just... I don\u2019t wanna end up like my dad.',
      }),
    );
  }, 10_000);

  it('a “mm-hm” from Ray while the resident talks stays listening: one resident turn, nothing saved', async () => {
    await start();
    await act(async () => cb.onStarted());
    // Ray says his opening line first.
    audible = true;
    await act(async () => cb.onSpoken('So, my blood pressure is high?', 0));
    await sleep(100);
    patientStops();
    await sleep(1700);
    micLoudAt = performance.now();
    await act(async () => cb.onHeard('Well, not really. The numbers reflect'));
    await sleep(100);
    // Ray: "Mm-hm." while the resident carries on.
    audible = true;
    await act(async () => cb.onSpoken('Mm-hm.', 3000));
    micLoudAt = performance.now();
    await act(async () => cb.onHeard(' the pressure inside your arteries.'));
    await sleep(100);
    patientStops();
    await sleep(1100);
    expect(screen.queryByText('Mm-hm.')).toBeNull();
    expect(muted).toEqual([]);
    expect(sessionApi.saveLiveExchange).not.toHaveBeenCalled();
    // Then a real answer closes the resident's (whole) turn.
    await sleep(600);
    audible = true;
    await act(async () => cb.onSpoken('So that means my heart works harder?', 6000));
    await sleep(120);
    expect(
      screen.getByText('Well, not really. The numbers reflect the pressure inside your arteries.'),
    ).toBeInTheDocument();
    expect(screen.getByText('So that means my heart works harder?')).toBeInTheDocument();
  });

  it('falls back to the standard voice when GPT-Live can’t connect', async () => {
    failConnect = true;
    const onFallback = await start();
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
    expect(onFallback.mock.calls[0]![0]).toMatch(/standard voice/);
    expect(onFallback.mock.calls[0]![1]).toBeNull();
  });
});
