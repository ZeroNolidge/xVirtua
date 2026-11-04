import { describe, expect, it } from 'vitest';
import { speechClarityPct, tallyWords } from './speech.js';

const lp = (p: number) => Math.log(p);

describe('speech clarity', () => {
  it('counts words, each as its least confident piece', () => {
    const s = tallyWords([
      { token: 'Your', logprob: lp(0.99) },
      { token: ' blood', logprob: lp(0.95) },
      { token: ' press', logprob: lp(0.9) },
      { token: 'ure', logprob: lp(0.4) },
      { token: ' is', logprob: lp(0.97) },
      { token: ' high', logprob: lp(0.6) },
      { token: '.', logprob: lp(0.99) },
    ]);
    expect(s).toEqual({ words: 5, clear: 3 });
  });

  it('needs enough speech to say anything', () => {
    expect(speechClarityPct({ words: 10, clear: 10 })).toBeNull();
    expect(speechClarityPct({ words: 200, clear: 170 })).toBe(85);
    expect(speechClarityPct(null)).toBeNull();
  });
});
