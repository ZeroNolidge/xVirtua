import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** British spellings to keep out of the app's words (US English throughout). */
const BRITISH =
  /\b(colou?rs?\b(?<=colours?)|centres?|practis(e|ed|es|ing)|behaviours?|favour\w*|organis(e|ed|es|ing|ation)|recognis\w*|realis(e|ed|es|ing)|apologis\w*|summaris\w*|minimis\w*|prioritis\w*|analys(e|ed|es|ing)|travelled|labelled|modelled|programme|judgement|grey|whilst|amongst|neighbours?|honours?|humour)\b/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('US spelling', () => {
  it('web/src uses US spellings', () => {
    const hits = files(join(__dirname))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => BRITISH.test(line)),
      )
      .map(({ f, i, line }) => `${f.split('/src/')[1]}:${i}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});
