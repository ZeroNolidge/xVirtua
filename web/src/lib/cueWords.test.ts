import { describe, expect, it } from 'vitest';
import { cueForWords, type CueRules } from './cueWords';
import ray from '../../public/avatars/ray-kowalski/manifest.json';

const rayGuarded = ray.cueWords.guarded as CueRules;

describe('body language from the patient’s words', () => {
  it('guarded Ray: his own worries show (from his manifest)', () => {
    expect(cueForWords('I don’t wanna end up like my dad.', 'guarded', rayGuarded)).toBe(
      'avoid_eye_contact',
    );
    expect(cueForWords('Will this mess with my CDL?', 'guarded', rayGuarded)).toBe('fidget');
    expect(cueForWords('Honestly, I feel fine.', 'guarded', rayGuarded)).toBe('frown');
    expect(cueForWords('I guess… I just…', 'guarded', rayGuarded)).toBe('look_away');
    expect(cueForWords('So my blood pressure is up again.', 'guarded', rayGuarded)).toBeNull();
  });
  it('without his own words, only the general ones apply', () => {
    expect(cueForWords('Will this mess with my CDL?', 'guarded')).toBeNull();
    expect(cueForWords('I guess so.', 'guarded')).toBe('look_away');
  });
  it('Ray at ease: warmth', () => {
    expect(cueForWords('That helps, doc. Thanks.', 'at_ease')).toBe('smile');
    expect(cueForWords('Okay, makes sense.', 'at_ease')).toBe('nod');
    expect(cueForWords('I drive a truck.', 'at_ease')).toBeNull();
  });
});
