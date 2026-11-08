import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: async () => ({ get: (k: string) => (k === 'avatarOn' ? true : undefined) }),
}));
vi.mock('./auth', () => ({ useAuth: () => ({ claims: { programId: 'irmc' } }) }));
vi.mock('./errorReport', () => ({ reportError: vi.fn() }));
const tokens = vi.fn(async (_input: unknown) => ({ data: { token: 't' } }));
vi.mock('./session', () => ({ sessionApi: { avatarSession: (i: unknown) => tokens(i) } }));

// Fake face: the test decides when it connects and when it drops.
let connects = 0;
let connectOk = true;
let instance: FakeAvatar | null = null;
class FakeAvatar {
  ready = false;
  onChange: ((r: boolean) => void) | null = null;
  onFail: ((e: unknown) => void) | null = null;
  async connect(getToken: () => Promise<string>) {
    connects++;
    await getToken();
    if (!connectOk) return false;
    this.ready = true;
    this.onChange?.(true);
    return true;
  }
  /** Simli ended the session (or the connection broke). */
  drop() {
    this.ready = false;
    this.onChange?.(false);
  }
  async stop() {
    this.ready = false;
    this.onChange?.(false);
  }
  async dispose() {}
  constructor() {
    instance = this;
  }
}
vi.mock('./avatar', () => ({ PatientAvatar: FakeAvatar }));

const { useAvatar, RECONNECT_WAITS_MS } = await import('./useAvatar');

const stage = {
  video: {} as HTMLVideoElement,
  audio: {} as HTMLAudioElement,
  clip: {} as HTMLVideoElement,
  spare: { video: {} as HTMLVideoElement, audio: {} as HTMLAudioElement },
};

async function startFace() {
  const h = renderHook(() => useAvatar('s1'));
  await act(async () => {}); // the program setting (avatarOn) loads
  h.result.current.stage.current = stage;
  await act(async () => {
    await h.result.current.start('guarded');
  });
  return h;
}

describe('the video face comes back when it drops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connects = 0;
    connectOk = true;
    instance = null;
    tokens.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('reconnects a little later, for the same mood, and the voice carries on meanwhile', async () => {
    const h = await startFace();
    expect(h.result.current.ready).toBe(true);
    expect(connects).toBe(1);

    act(() => instance!.drop());
    expect(h.result.current.ready).toBe(false);
    expect(h.result.current.everReady).toBe(true); // the still picture stays up

    await act(async () => {
      vi.advanceTimersByTime(RECONNECT_WAITS_MS[0]!);
    });
    await act(async () => {});
    expect(connects).toBe(2);
    expect(tokens).toHaveBeenLastCalledWith({ sessionId: 's1', mood: 'guarded' });
    expect(h.result.current.ready).toBe(true);
  });

  it('gives up after a few tries, each one later than the last', async () => {
    const h = await startFace();
    connectOk = false;
    act(() => instance!.drop());
    for (const wait of RECONNECT_WAITS_MS) {
      await act(async () => {
        vi.advanceTimersByTime(wait);
      });
      await act(async () => {});
    }
    expect(connects).toBe(1 + RECONNECT_WAITS_MS.length);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(connects).toBe(1 + RECONNECT_WAITS_MS.length);
    expect(h.result.current.ready).toBe(false);
  });

  it('does not reconnect a face we stopped on purpose (pause, end)', async () => {
    const h = await startFace();
    act(() => h.result.current.stop());
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(connects).toBe(1);
  });

  it('after a mood change, reconnects with the new mood', async () => {
    const h = await startFace();
    // Pretend the next face was prepared and swapped in.
    (instance as unknown as { prepareFace: () => Promise<boolean> }).prepareFace = async () => true;
    (instance as unknown as { commitFace: () => boolean }).commitFace = () => true;
    await act(async () => {
      await h.result.current.prepare('at_ease');
      h.result.current.commit();
    });
    act(() => instance!.drop());
    await act(async () => {
      vi.advanceTimersByTime(RECONNECT_WAITS_MS[0]!);
    });
    await act(async () => {});
    expect(tokens).toHaveBeenLastCalledWith({ sessionId: 's1', mood: 'at_ease' });
  });
});
