import { describe, expect, it } from 'vitest';
import { decideCue, detectUnderstandingCheck, initialCueState, type CueState } from './cues.js';
import { createJargonMatcher, SEED_JARGON } from './jargon.js';
import type { CueScriptEntry } from './model.js';

const m = createJargonMatcher(SEED_JARGON);
const cue = (id: string, trigger: CueScriptEntry['trigger'], maxFires = 1): CueScriptEntry => ({
  id,
  cue: id,
  trigger,
  maxFires,
  performance: { say: id, delivery: {}, nonverbal: [] },
  expectedResidentResponse: '',
});

describe('detectUnderstandingCheck', () => {
  it('separates teach-back from weak checks', () => {
    expect(
      detectUnderstandingCheck('Can you tell me in your own words what we talked about?'),
    ).toBe('teachback');
    expect(
      detectUnderstandingCheck('To make sure I explained it well, what will you tell your wife?'),
    ).toBe('teachback');
    expect(detectUnderstandingCheck('Any questions?')).toBe('weak');
    expect(detectUnderstandingCheck('Does that make sense?')).toBe('weak');
    expect(detectUnderstandingCheck('Your pressure is high.')).toBeNull();
  });
});

describe('decideCue', () => {
  const long = 'word '.repeat(95);

  it('fires on long turns, topics, jargon and turn index', () => {
    const s = initialCueState();
    expect(
      decideCue([cue('a', { type: 'resident_turn_words_gt', value: 90 })], s, long, m).cue?.id,
    ).toBe('a');
    expect(
      decideCue(
        [cue('b', { type: 'topic_mentioned', topics: ['pill'] })],
        s,
        'We can start a pill.',
        m,
      ).cue?.id,
    ).toBe('b');
    expect(
      decideCue([cue('b', { type: 'topic_mentioned', topics: ['pill'] })], s, 'Pillow talk.', m)
        .cue,
    ).toBeNull();
    expect(
      decideCue(
        [cue('c', { type: 'jargon_in_turn_gte', value: 2 })],
        s,
        'Your hypertension and lipids.',
        m,
      ).cue?.id,
    ).toBe('c');
    expect(decideCue([cue('d', { type: 'turn_index', value: 2 })], s, 'Hi', m).cue).toBeNull();
    const s2: CueState = { ...s, patientReplies: 1 };
    expect(decideCue([cue('d', { type: 'turn_index', value: 2 })], s2, 'Hi', m).cue?.id).toBe('d');
  });

  it('respects maxFires and only fires one cue per turn, earliest first', () => {
    const script = [
      cue('a', { type: 'topic_mentioned', topics: ['pill'] }),
      cue('b', { type: 'resident_turn_words_gt', value: 1 }),
    ];
    const r1 = decideCue(script, initialCueState(), 'Take this pill daily.', m);
    expect(r1.cue?.id).toBe('a');
    const r2 = decideCue(script, r1.next, 'Take this pill daily.', m);
    expect(r2.cue?.id).toBe('b');
    const r3 = decideCue(script, r2.next, 'Take this pill daily.', m);
    expect(r3.cue).toBeNull();
  });

  it('turn_index fires late if it was blocked by another cue', () => {
    const script = [
      cue('topic', { type: 'topic_mentioned', topics: ['pill'] }),
      cue('t2', { type: 'turn_index', value: 2 }),
    ];
    let s = initialCueState();
    s = decideCue(script, s, 'hello', m).next; // reply 1
    const r = decideCue(script, s, 'a pill', m); // reply 2: topic wins
    expect(r.cue?.id).toBe('topic');
    expect(decideCue(script, r.next, 'ok', m).cue?.id).toBe('t2'); // reply 3
  });

  it('counts turns without an understanding check and resets on a check', () => {
    const script = [cue('r', { type: 'no_understanding_check_for_turns', value: 3 })];
    let s = initialCueState();
    for (const text of ['a', 'b']) s = decideCue(script, s, text, m).next;
    expect(decideCue(script, s, 'Any questions?', m).cue).toBeNull();
    const r = decideCue(script, s, 'c', m);
    expect(r.cue?.id).toBe('r');
    expect(r.next.turnsWithoutCheck).toBe(0);
  });

  it('reports turn facts', () => {
    const r = decideCue([], initialCueState(), 'Your hypertension is high. Any questions?', m);
    expect(r.turnFacts).toEqual({ words: 6, jargonCount: 1, understandingCheck: 'weak' });
  });
});
