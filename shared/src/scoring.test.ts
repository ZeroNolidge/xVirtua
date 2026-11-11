import { pronounWords, trendFor, TREND_TEXT } from './model.js';
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

describe('trend wording by size of change', () => {
  it('a little, or more than a little', () => {
    expect(trendFor(80, 70)).toBe('up');
    expect(TREND_TEXT[trendFor(80, 70)]).toBe('a little higher than last time');
    expect(trendFor(90, 70)).toBe('up_more');
    expect(TREND_TEXT[trendFor(90, 70)]).toBe('up from last time');
    expect(trendFor(70, 80)).toBe('down');
    expect(TREND_TEXT[trendFor(70, 80)]).toBe('a little lower than last time');
    expect(trendFor(40, 90)).toBe('down_more');
    expect(TREND_TEXT[trendFor(40, 90)]).toBe('lower than last time');
    expect(trendFor(72, 70)).toBe('same');
    expect(trendFor(72, null)).toBe('first');
  });
});

describe('pronounWords', () => {
  it('follows the persona', () => {
    expect(pronounWords('he/him')).toEqual({
      they: 'he',
      them: 'him',
      their: 'his',
      themself: 'himself',
    });
    expect(pronounWords('she/her')).toEqual({
      they: 'she',
      them: 'her',
      their: 'her',
      themself: 'herself',
    });
    expect(pronounWords('they/them').their).toBe('their');
    expect(pronounWords(undefined).them).toBe('them');
  });
});
