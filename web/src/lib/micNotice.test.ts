import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterMicOpened,
  micIndicator,
  NO_MIC_NOTICE,
  rememberMicFailed,
  rememberMicOpened,
  useNoMic,
} from './micNotice';

describe('one mic state on screen', () => {
  it('no mic: no "Mic ready" under the alert', () => {
    expect(micIndicator(false, NO_MIC_NOTICE, false)).toBeNull();
    expect(micIndicator(true, null, false)).toBeNull(); // typing
  });
  it('mic working: the indicator shows', () => {
    expect(micIndicator(false, null, false)).toBe('○ Mic ready');
    expect(micIndicator(false, 'Five minutes left.', true)).toBe('● Mic on');
  });
  it('the mic opens after all: the alert goes, other notices stay', () => {
    expect(afterMicOpened(NO_MIC_NOTICE)).toBeNull();
    expect(afterMicOpened('Five minutes left.')).toBe('Five minutes left.');
  });
});

describe('useNoMic', () => {
  const setDevices = (kinds: string[]) =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
        enumerateDevices: async () => kinds.map((kind) => ({ kind })),
      },
    });
  afterEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  it('a computer with a mic: not no-mic', async () => {
    setDevices(['audioinput', 'audiooutput']);
    const { result } = renderHook(() => useNoMic());
    await act(async () => {});
    expect(result.current[0]).toBe(false);
  });

  it('getUserMedia but no audio input device listed: no mic', async () => {
    setDevices(['audiooutput', 'videoinput']);
    const { result } = renderHook(() => useNoMic());
    await act(async () => {});
    expect(result.current[0]).toBe(true);
  });

  it('an earlier failed mic request: no mic from the start', () => {
    setDevices(['audioinput']);
    rememberMicFailed();
    expect(localStorage.getItem('ps.noMic')).toBe('1');
    const { result } = renderHook(() => useNoMic());
    expect(result.current[0]).toBe(true);
  });

  it('a mic opening clears the earlier failure', async () => {
    setDevices(['audioinput']);
    rememberMicFailed();
    rememberMicOpened();
    expect(localStorage.getItem('ps.noMic')).toBeNull();
    const { result } = renderHook(() => useNoMic());
    await act(async () => {});
    expect(result.current[0]).toBe(false);
  });

  it('blocked storage doesn’t break it', () => {
    setDevices(['audioinput']);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => rememberMicFailed()).not.toThrow();
      const { result } = renderHook(() => useNoMic());
      expect(result.current[0]).toBe(false);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
