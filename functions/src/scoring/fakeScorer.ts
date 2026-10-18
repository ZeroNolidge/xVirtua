import type { ClaudeScore, Scorer } from './score.js';

/**
 * Offline stand-in for the Claude scorer, used only by tests and the local
 * emulator. Quotes the first few words of real resident lines so quote
 * validation passes.
 */
export function fakeScorer(): Scorer {
  return async (_system, user) => {
    const resident = [...user.matchAll(/^\[T(\d+)\] RESIDENT(?: \([^)]*\))?: (.+)$/gm)].map(
      (m) => ({
        idx: Number(m[1]),
        text: m[2]!,
      }),
    );
    const first = resident[0] ?? { idx: 1, text: 'Hello' };
    const last = resident[resident.length - 1] ?? first;
    const q = (t: string) => t.split(' ').slice(0, 6).join(' ');
    const m = (score: number) => ({
      score,
      summary: 'Practice summary (offline scorer).',
      evidence: [{ turnIdx: first.idx, quote: q(first.text), note: 'Example evidence.' }],
      tryThisInstead: {
        turnIdx: last.idx,
        original: q(last.text),
        rewrite: 'Can you tell me in your own words what we talked about?',
      },
    });
    const out: ClaudeScore = {
      jargonTryThisInstead: null,
      clarity: m(72),
      empathy: m(80),
      cue: { ...m(65), cueResults: [], steamrolls: [] },
      highlight: {
        metric: 'empathy',
        turnIdx: first.idx,
        quote: q(first.text),
        note: 'A warm start.',
      },
      fixes: [
        {
          metric: 'clarity',
          turnIdx: last.idx,
          quote: q(last.text),
          note: 'Check what they understood.',
          rewrite: 'Can you tell me in your own words what we talked about?',
        },
      ],
    };
    return { raw: JSON.stringify(out), model: 'fake-scorer' };
  };
}
