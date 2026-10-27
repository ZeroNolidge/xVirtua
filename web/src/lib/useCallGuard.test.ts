import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallGuard } from './useCallGuard';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(startedAtMs = Date.now()) {
  const onPause = vi.fn();
  const onWarn = vi.fn();
  const onTimeUp = vi.fn();
  const hook = renderHook(
    ({ active }) => useCallGuard({ active, startedAtMs, onPause, onWarn, onTimeUp }),
    { initialProps: { active: true } },
  );
  return { hook, onPause, onWarn, onTimeUp };
}

describe('useCallGuard', () => {
  it('asks "Still there?" after 2 quiet minutes, then pauses 30 s later', () => {
    const { hook, onPause } = setup();
    act(() => void vi.advanceTimersByTime(119_000));
    expect(hook.result.current.askingStillThere).toBe(false);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(hook.result.current.askingStillThere).toBe(true);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(onPause).toHaveBeenCalledWith('quiet');
    expect(hook.result.current.askingStillThere).toBe(false);
  });

  it('“I’m here” or anyone talking resets the quiet timer', () => {
    const { hook, onPause } = setup();
    act(() => void vi.advanceTimersByTime(121_000));
    act(() => hook.result.current.stillHere());
    expect(hook.result.current.askingStillThere).toBe(false);
    act(() => void vi.advanceTimersByTime(60_000));
    act(() => hook.result.current.activity());
    act(() => void vi.advanceTimersByTime(100_000));
    expect(onPause).not.toHaveBeenCalled();
  });

  it('pauses as soon as the app is hidden', () => {
    const { onPause } = setup();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(onPause).toHaveBeenCalledWith('hidden');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('does nothing while not active (paused, or before the call starts)', () => {
    const { hook, onPause } = setup();
    hook.rerender({ active: false });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(300_000));
    expect(onPause).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('warns 5 minutes before the 45-minute limit, then ends', () => {
    const { hook, onWarn, onTimeUp } = setup(Date.now() - 39 * 60_000);
    act(() => void vi.advanceTimersByTime(61_000));
    expect(onWarn).toHaveBeenCalledWith(5);
    // Keep talking so the quiet pause doesn't come first.
    for (let i = 0; i < 5; i++) {
      act(() => hook.result.current.activity());
      act(() => void vi.advanceTimersByTime(60_000));
    }
    expect(onTimeUp).toHaveBeenCalled();
  });
});
