/**
 * Filler words ("um", "uh") in the resident's spoken turns. Not part of the
 * score: a count and a rate, shown with the feedback, with the goal of fewer
 * each time. Only spoken turns count (typed ones have none).
 */
export const FILLER_WORDS = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mmm'] as const;
/** Two-word fillers, counted as one each. */
export const FILLER_PHRASES = ['you know', 'i mean'] as const;

export interface FillerStats {
  /** Filler words in the resident's spoken turns. */
  count: number;
  /** Words the resident spoke (fillers included). */
  words: number;
  /** Fillers per 100 spoken words, one decimal. */
  per100: number;
  /** Each filler and how often ("um": 7). Only those used. */
  byWord: Record<string, number>;
}

export type FillerLevel = 'few' | 'some' | 'many';
export type FillerTrend = 'first' | 'fewer' | 'same' | 'more';

const PHRASE_RE = new RegExp(`\\b(${FILLER_PHRASES.join('|').replace(/ /g, '\\s+')})\\b`, 'gi');
const WORD_RE = new RegExp(`\\b(${FILLER_WORDS.join('|')})\\b`, 'gi');

/** Counts the fillers in the resident's spoken turns. */
export function countFillers(spokenTexts: string[]): FillerStats {
  const byWord: Record<string, number> = {};
  let count = 0;
  let words = 0;
  for (const text of spokenTexts) {
    words += text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
    const add = (m: string) => {
      const key = m.toLowerCase().replace(/\s+/g, ' ');
      byWord[key] = (byWord[key] ?? 0) + 1;
      count++;
    };
    // Phrases first, then single words in what's left.
    text.replace(PHRASE_RE, (m) => (add(m), ' ')).replace(WORD_RE, (m) => (add(m), ' '));
  }
  const per100 = words ? Math.round((count / words) * 1000) / 10 : 0;
  return { count, words, per100, byWord };
}

/** Few: about one in 70 words or less. Many: one in 25 or more. */
export function fillerLevel(per100: number): FillerLevel {
  if (per100 <= 1.5) return 'few';
  if (per100 < 4) return 'some';
  return 'many';
}

/** Against the previous spoken conversation's rate (half a filler per 100 words is "the same"). */
export function fillerTrend(per100: number, previous: number | null | undefined): FillerTrend {
  if (previous == null) return 'first';
  const d = per100 - previous;
  if (d <= -0.5) return 'fewer';
  if (d >= 0.5) return 'more';
  return 'same';
}

export const FILLER_LEVEL_TEXT: Record<FillerLevel, string> = {
  few: 'Hardly any. Nice and steady.',
  some: 'A few. Pausing in silence instead keeps your point clear.',
  many: 'Quite a few. A short silent pause lands better than “um”.',
};

export const FILLER_TREND_TEXT: Record<FillerTrend, string> = {
  first: 'Your first spoken conversation: this is your starting point.',
  fewer: 'Fewer than last time. Keep going.',
  same: 'About the same as last time.',
  more: 'More than last time. Try a silent pause instead.',
};
