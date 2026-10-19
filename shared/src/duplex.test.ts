import { describe, expect, it } from 'vitest';
import { isResidentSpeech } from './duplex.js';

describe('two-way voice echo guard', () => {
  const ray =
    'My dad had a stroke around my age and it was bad, so I don’t really want to mess around with this.';
  it('treats the patient’s own words coming back through the mic as echo', () => {
    expect(isResidentSpeech('my dad had a stroke around my age', ray)).toBe(false);
    expect(isResidentSpeech('mess around with this', ray)).toBe(false);
    expect(isResidentSpeech('um', ray)).toBe(false);
  });
  it('recognizes the resident talking over the patient', () => {
    expect(isResidentSpeech('I’m so sorry to hear that', ray)).toBe(true);
    expect(isResidentSpeech('wait, can I ask you something', ray)).toBe(true);
  });
});
