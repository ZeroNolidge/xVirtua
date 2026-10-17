import { describe, expect, it } from 'vitest';
import { overallScore } from './scoring.js';
import { DEFAULT_SCORING_WEIGHTS } from './constants.js';

describe('overallScore', () => {
  it('averages equally with default weights', () => {
    expect(
      overallScore({ jargon: 80, clarity: 60, empathy: 100, cue: 40 }, DEFAULT_SCORING_WEIGHTS),
    ).toBe(70);
  });

  it('re-normalizes when a metric is missing', () => {
    expect(overallScore({ jargon: 90, clarity: 60, empathy: 60 }, DEFAULT_SCORING_WEIGHTS)).toBe(
      70,
    );
  });

  it('clamps out-of-range scores', () => {
    expect(
      overallScore({ jargon: 150, clarity: -10, empathy: 50, cue: 50 }, DEFAULT_SCORING_WEIGHTS),
    ).toBe(50);
  });

  it('returns null with nothing to score', () => {
    expect(overallScore({}, DEFAULT_SCORING_WEIGHTS)).toBeNull();
  });
});
