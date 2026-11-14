import { describe, expect, it } from 'vitest';
import { countFillers, fillerLevel, fillerTrend } from './fillers.js';

describe('filler words', () => {
  it('counts um, uh and friends, and two-word fillers, per 100 spoken words', () => {
    const s = countFillers([
      'So, um, your blood pressure is, uh, a little high.',
      'You know, it’s umm… not dangerous today. Um, we can treat it.',
    ]);
    expect(s.count).toBe(5);
    expect(s.byWord).toEqual({ um: 2, uh: 1, 'you know': 1, umm: 1 });
    expect(s.words).toBe(22);
    expect(s.per100).toBe(22.7);
  });

  it('does not count ordinary words that contain a filler, or an empty transcript', () => {
    const s = countFillers(['Humm, the drummer ran a numb hum.', 'Ahead of time.']);
    expect(s.count).toBe(0);
    expect(countFillers([])).toEqual({ count: 0, words: 0, per100: 0, byWord: {} });
  });

  it('levels and trend: fewer per 100 words is better', () => {
    expect(fillerLevel(0.8)).toBe('few');
    expect(fillerLevel(2.5)).toBe('some');
    expect(fillerLevel(6)).toBe('many');
    expect(fillerTrend(2, null)).toBe('first');
    expect(fillerTrend(2, 3)).toBe('fewer');
    expect(fillerTrend(2, 2.3)).toBe('same');
    expect(fillerTrend(3, 2)).toBe('more');
  });
});
