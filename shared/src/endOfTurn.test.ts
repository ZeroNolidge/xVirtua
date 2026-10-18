import { describe, expect, it } from 'vitest';
import { END_OF_TURN_MS, endOfTurnDelayMs } from './endOfTurn.js';

describe('end of turn', () => {
  it('waits longest when the resident trails off mid-thought', () => {
    for (const t of [
      'So the plan is,',
      'We could start a pill and',
      'Your pressure is high, um.',
      'I think we should',
      'The reason is because…',
      'so we could try...',
    ]) {
      expect(endOfTurnDelayMs(t), t).toBe(END_OF_TURN_MS.unfinished);
    }
  });
  it('sends sooner after a finished sentence, soonest after a question', () => {
    expect(endOfTurnDelayMs('We will check it again next month.')).toBe(END_OF_TURN_MS.done);
    expect(endOfTurnDelayMs('Can you tell me in your own words what we will do?')).toBe(
      END_OF_TURN_MS.question,
    );
  });
});
