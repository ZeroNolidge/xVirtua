import { describe, expect, it } from 'vitest';
import {
  JsonStringFieldReader,
  parseJsonPrefix,
  SentenceSplitter,
  stripStageDirections,
} from './stream.js';

describe('JsonStringFieldReader', () => {
  it('decodes the text field as it streams, including split escapes', () => {
    const json = JSON.stringify({
      cueId: null,
      text: 'Well, "high" pressure—is that bad?\nI guess.',
    });
    const r = new JsonStringFieldReader('text');
    const seen: string[] = [];
    for (let i = 0; i < json.length; i += 3) seen.push(r.push(json.slice(i, i + 3)));
    expect(r.done).toBe(true);
    expect(r.value).toBe('Well, "high" pressure—is that bad? I guess.');
    // Grows monotonically.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.startsWith(seen[i - 1]!)).toBe(true);
  });

  it('waits for the field to appear', () => {
    const r = new JsonStringFieldReader('text');
    expect(r.push('{"delivery":{"emotion":"sad"},')).toBe('');
    expect(r.push('"text": "Hi')).toBe('Hi');
    expect(r.done).toBe(false);
    expect(parseJsonPrefix(r.before)).toEqual({ delivery: { emotion: 'sad' } });
  });
});

describe('SentenceSplitter', () => {
  it('emits complete sentences, joining tiny fragments', () => {
    const s = new SentenceSplitter();
    expect(s.take('Oh. I see what you')).toEqual([]);
    expect(s.take('Oh. I see what you mean. So is it')).toEqual(['Oh. I see what you mean.']);
    expect(s.take('Oh. I see what you mean. So is it serious?', true)).toEqual([
      'So is it serious?',
    ]);
  });
});

describe('stripStageDirections', () => {
  it('removes parenthetical and starred directions', () => {
    expect(stripStageDirections('(frowns) I don’t know, *looks away* maybe.')).toBe(
      'I don’t know, maybe.',
    );
  });
});
