import { describe, expect, it } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { neverStarted } from './resume';

const now = Date.now();
const ts = (ms: number) => ({ toMillis: () => ms }) as Timestamp;
const row = (over: object) => ({
  status: 'live' as const,
  turnCount: 1,
  startedAt: ts(now - 864e5),
  lastActivityAt: ts(now - 864e5),
  ...over,
});

describe('neverStarted (left out of the history)', () => {
  it('open, only the patient spoke, and too late to carry on', () => {
    expect(neverStarted(row({}), now)).toBe(true);
  });
  it('keeps one that can still be continued', () => {
    expect(
      neverStarted(row({ startedAt: ts(now - 6e4), lastActivityAt: ts(now - 6e4) }), now),
    ).toBe(false);
  });
  it('keeps one where the resident spoke, or that ended', () => {
    expect(neverStarted(row({ turnCount: 3 }), now)).toBe(false);
    expect(neverStarted(row({ status: 'ended' }), now)).toBe(false);
  });
});
