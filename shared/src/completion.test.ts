import { describe, expect, it } from 'vitest';
import { bestStatus, completionOf, shortOf } from './completion.js';

const all = (b: 'Just starting' | 'Getting there' | 'Solid' | 'Strong') => ({
  jargon: b,
  clarity: b,
  empathy: b,
  cue: b,
});

describe('completing a patient', () => {
  it('needs Solid in every area and the key moment', () => {
    const hit = [{ cue: 'Worries about his job', addressed: true }];
    expect(completionOf(all('Solid'), hit)).toBe('completed');
    expect(completionOf(all('Strong'), hit)).toBe('mastered');
    expect(completionOf({ ...all('Strong'), cue: 'Getting there' }, hit)).toBeNull();
    expect(completionOf(all('Strong'), [{ cue: null, addressed: false }])).toBeNull();
    expect(shortOf({ ...all('Solid'), empathy: 'Getting there' })).toEqual(['empathy']);
  });

  it('never goes back down', () => {
    expect(bestStatus('mastered', 'started')).toBe('mastered');
    expect(bestStatus('started', 'completed')).toBe('completed');
    expect(bestStatus(undefined, null)).toBe('started');
  });
});
