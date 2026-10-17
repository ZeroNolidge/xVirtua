import { describe, expect, it } from 'vitest';
import { RUBRIC_VERSION } from '@plainspeak/shared';

describe('functions workspace', () => {
  it('resolves the shared package', () => {
    expect(RUBRIC_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });
});
