import { describe, expect, it } from 'vitest';
import { cueForWords, type CueRules } from './cueWords';
import ray from '../../public/avatars/ray-kowalski/manifest.json';
import linda from '../../public/avatars/linda-shaffer/manifest.json';
import tessa from '../../public/avatars/tessa-burns/manifest.json';

const rayGuarded = ray.cueWords.guarded as CueRules;
const lindaGuarded = linda.cueWords.guarded as CueRules;
const tessaGuarded = tessa.cueWords.guarded as CueRules;

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
  it('guarded Linda: her mom, needles, shame, and nodding along', () => {
    expect(cueForWords('My mom lost her foot to it.', 'guarded', lindaGuarded)).toBe(
      'avoid_eye_contact',
    );
    expect(cueForWords('Will I need shots?', 'guarded', lindaGuarded)).toBe('fidget');
    expect(cueForWords('I’m sorry, I should have known.', 'guarded', lindaGuarded)).toBe(
      'look_away',
    );
    expect(cueForWords('Mm-hm. Okay.', 'guarded', lindaGuarded)).toBe('nod');
    expect(cueForWords('So the number is high?', 'guarded', lindaGuarded)).toBeNull();
  });
  it('guarded Tessa: her sister on the medicine, a daily pill, her husband’s judgment', () => {
    expect(cueForWords('My sister was like a zombie on it.', 'guarded', tessaGuarded)).toBe(
      'avoid_eye_contact',
    );
    expect(cueForWords('I’ve never taken pills every day.', 'guarded', tessaGuarded)).toBe(
      'fidget',
    );
    expect(cueForWords('My husband thinks it’s for weak people.', 'guarded', tessaGuarded)).toBe(
      'look_away',
    );
    expect(cueForWords('Okay.', 'guarded', tessaGuarded)).toBe('nod');
    expect(cueForWords('So you think I need this?', 'guarded', tessaGuarded)).toBeNull();
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
