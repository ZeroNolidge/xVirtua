import { describe, expect, it } from 'vitest';
import { cueForWords } from './cueWords';

describe('body language from the patient’s words', () => {
  it('guarded Ray: his worries show', () => {
    expect(cueForWords('I don’t wanna end up like my dad.', 'guarded')).toBe('avoid_eye_contact');
    expect(cueForWords('Will this mess with my CDL?', 'guarded')).toBe('fidget');
    expect(cueForWords('Honestly, I feel fine.', 'guarded')).toBe('frown');
    expect(cueForWords('I guess… I just…', 'guarded')).toBe('look_away');
    expect(cueForWords('So my blood pressure is up again.', 'guarded')).toBeNull();
  });
  it('Ray at ease: warmth', () => {
    expect(cueForWords('That helps, doc. Thanks.', 'at_ease')).toBe('smile');
    expect(cueForWords('Okay, makes sense.', 'at_ease')).toBe('nod');
    expect(cueForWords('I drive a truck.', 'at_ease')).toBeNull();
  });
});
