/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f: string) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('resident bundle', () => {
  it('app code never imports the seed scenarios (hidden concerns, cue scripts)', () => {
    const offenders = files('src')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('@plainspeak/shared/seed'));
    expect(offenders).toEqual([]);
  });
});
