import { describe, expect, it } from 'vitest';
import { isEcho, LiveReply } from './liveReply';

describe('LiveReply', () => {
  it('keeps only the words that had started playing when cut off', () => {
    const r = new LiveReply(4, 'r1', 0);
    r.add('Will ', 1000);
    r.add('I ', 1300);
    r.add('lose my license? ', 1700);
    r.add('I drive a truck.', 3000);
    r.firstAudibleAt = 100;
    expect(r.cutOff(900)).toBe('Will I lose my license?');
    expect(r.cutAtMs).toBe(800);
    // Once cut, it stays cut.
    expect(r.cutOff(5000)).toBe('Will I lose my license?');
  });

  it('heard nothing if cut off before any sound', () => {
    const r = new LiveReply(4, 'r1', 0);
    r.add('Will I', 0);
    expect(r.cutOff(500)).toBe('');
  });

  it('uses the whole transcript when GPT-Live gives no times', () => {
    const r = new LiveReply(4, 'r1', 0);
    r.add('Okay. ');
    r.add('Sure.');
    r.firstAudibleAt = 0;
    expect(r.cutOff(10)).toBe('Okay. Sure.');
  });
});

describe('isEcho', () => {
  it('flags pieces made only of the patient’s words', () => {
    expect(isEcho('will I lose', 'Will I lose my license?')).toBe(true);
    expect(isEcho(' no wait, can I ask', 'Will I lose my license?')).toBe(false);
    expect(isEcho('  ', 'anything')).toBe(false);
  });
});
