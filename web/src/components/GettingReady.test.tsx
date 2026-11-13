import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GettingReady, READY_STEPS } from './GettingReady';

describe('GettingReady', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a spinner, and a line that moves on every few seconds', () => {
    render(<GettingReady first="Ray" />);
    const status = screen.getByRole('status');
    expect(status.querySelector('.spinner')).not.toBeNull();
    expect(status).toHaveTextContent('Preparing the room…');
    act(() => {
      vi.advanceTimersByTime(READY_STEPS[1]!.atMs);
    });
    expect(status).toHaveTextContent('Getting Ray ready…');
    act(() => {
      vi.advanceTimersByTime(READY_STEPS[2]!.atMs - READY_STEPS[1]!.atMs);
    });
    expect(status).toHaveTextContent('Adding the final touches…');
    act(() => {
      vi.advanceTimersByTime(READY_STEPS[3]!.atMs - READY_STEPS[2]!.atMs);
    });
    expect(status).toHaveTextContent('Almost there…');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(status).toHaveTextContent('Almost there…'); // stays on the last line
  });

  it('a later screen picks up at a later step', () => {
    render(<GettingReady first="Linda" from={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Getting Linda ready…');
    act(() => {
      vi.advanceTimersByTime(READY_STEPS[2]!.atMs - READY_STEPS[1]!.atMs);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Adding the final touches…');
  });
});
