import { describe, expect, it } from 'vitest';
import { VIDEO_CHARACTERS, pronounWords } from './index.js';

describe('video characters', () => {
  it('each has pronouns, so the words around their face fit (Linda is "she")', () => {
    for (const c of Object.values(VIDEO_CHARACTERS)) expect(c.pronouns).toMatch(/\//);
    expect(pronounWords(VIDEO_CHARACTERS['linda-shaffer']!.pronouns).their).toBe('her');
    expect(pronounWords(VIDEO_CHARACTERS['ray-kowalski']!.pronouns).their).toBe('his');
  });
});
