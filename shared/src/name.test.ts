import { describe, expect, it } from 'vitest';
import { cleanPreferredName } from './constants.js';

describe('preferred name', () => {
  it('tidies a name and rejects empty or over-long ones', () => {
    expect(cleanPreferredName('  Dr.   Sam  Lee ')).toBe('Dr. Sam Lee');
    expect(cleanPreferredName('<b>Sam</b>')).toBe('bSam/b');
    expect(cleanPreferredName('   ')).toBeNull();
    expect(cleanPreferredName('x'.repeat(41))).toBeNull();
    expect(cleanPreferredName('x'.repeat(40))).toHaveLength(40);
    expect(cleanPreferredName(7)).toBeNull();
  });
});
