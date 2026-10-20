import { describe, expect, it } from 'vitest';
import type { Moment } from '@plainspeak/shared';
import { classifyCutoffs, isBackchannel, limitInterruptionNotes } from './interruptions.js';

const cut = (idx: number, heardText: string) => ({
  idx,
  speaker: 'patient' as const,
  text: `${heardText} —`,
  interrupted: true,
  heardText,
});
const res = (idx: number, text: string) => ({ idx, speaker: 'resident' as const, text });

describe('which cut-offs count', () => {
  it('a listening word never counts; a cut-off the app caused never counts', () => {
    expect(isBackchannel('Sorry,')).toBe(true);
    expect(isBackchannel('mm-hm')).toBe(true);
    expect(isBackchannel('Right, go on.')).toBe(true);
    expect(isBackchannel('Right, so about your pills')).toBe(false);
    const turns = [
      res(1, 'Hi.'),
      cut(2, 'My dad had a stroke'),
      res(3, 'Mm-hm.'),
      cut(4, 'Well'),
      res(5, 'Anyway the pills'),
      cut(6, 'I worry about my job'),
      res(7, 'Let me tell you about the pills.'),
    ];
    expect([...classifyCutoffs(turns)]).toEqual([
      [2, 'backchannel'],
      [4, 'app'],
      [6, 'counts'],
    ]);
  });
});

describe('at most one interruption note', () => {
  const turns = [
    res(1, 'Hi.'),
    cut(2, 'My dad had a stroke and I'),
    res(3, 'Anyway, about your pills.'),
    cut(4, 'Sorry'),
    res(5, 'Let me finish.'),
  ];
  const fix = (turnIdx: number, note: string, rewrite?: string): Moment => ({
    metric: 'cue',
    turnIdx,
    quote: 'x',
    note,
    ...(rewrite ? { rewrite } : {}),
  });

  it('keeps one, about a cut-off that counts, with a way back that names the worry', () => {
    const r = limitInterruptionNotes(
      [fix(5, 'You cut Ray off again.'), fix(3, 'You cut Ray off as he raised his dad.')],
      [{ key: 'cue:0', turnIdx: 3, note: 'Talked over the patient here.' }],
      turns,
    );
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0]!.turnIdx).toBe(3);
    expect(r.fixes[0]!.rewrite).toBe(
      'Sorry, I jumped in. You were saying "My dad had a stroke and I…" — please go on.',
    );
    expect([...r.dropEvidence]).toEqual(['cue:0']);
  });

  it('leaves other fixes alone', () => {
    const r = limitInterruptionNotes([fix(3, 'Explain the numbers.', 'Try: …')], [], turns);
    expect(r.fixes).toHaveLength(1);
  });
});
