/**
 * Quote checking. Every quote in the feedback must be something that was
 * actually said in this session, by the speaker it's attributed to. Small
 * wording differences (a dropped "um", a changed "you're/you are") are
 * allowed; the quote shown is then replaced with the exact words said.
 */

interface Word {
  /** As written in the transcript. */
  raw: string;
  /** Lowercase letters/digits only, for comparing. */
  key: string;
}

const keyOf = (w: string) =>
  w
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');

function wordsOf(text: string): Word[] {
  return text
    .split(/\s+/)
    .map((raw) => ({ raw, key: keyOf(raw) }))
    .filter((w) => w.key);
}

/** Length of the longest common subsequence of two word lists. */
function lcs(a: string[], b: string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** How close a quote must be to what was said (word overlap, 0–1). */
export const MIN_SIMILARITY = 0.85;

/**
 * Finds `quote` in `text`. Returns the exact words from the text that it
 * matches, or null. Quotes of 3 words or fewer must match exactly. A quote
 * with "…" in it matches each piece in order.
 */
export function matchQuote(quote: string, text: string): string | null {
  const parts = quote
    .split(/\.{3}|…/)
    .map((p) => wordsOf(p).map((w) => w.key))
    .filter((p) => p.length);
  if (!parts.length) return null;
  const words = wordsOf(text);
  const keys = words.map((w) => w.key);
  const found: string[] = [];
  let from = 0;
  for (const q of parts) {
    const hit = bestWindow(q, keys, from);
    if (!hit) return null;
    found.push(
      words
        .slice(hit.start, hit.end)
        .map((w) => w.raw)
        .join(' '),
    );
    from = hit.end;
  }
  return found.join(' … ').replace(/^[^\w‘’“”"']+|[,;:]+$/g, '');
}

function bestWindow(
  q: string[],
  keys: string[],
  from: number,
): { start: number; end: number } | null {
  // Exact first.
  for (let i = from; i + q.length <= keys.length; i++) {
    if (q.every((w, j) => keys[i + j] === w)) return { start: i, end: i + q.length };
  }
  if (q.length <= 3) return null;
  let best: { start: number; end: number; sim: number } | null = null;
  for (let len = Math.max(1, q.length - 2); len <= q.length + 2; len++) {
    for (let i = from; i + len <= keys.length; i++) {
      const w = keys.slice(i, i + len);
      const sim = (2 * lcs(q, w)) / (q.length + w.length);
      if (sim >= MIN_SIMILARITY && (!best || sim > best.sim))
        best = { start: i, end: i + len, sim };
    }
  }
  return best && { start: best.start, end: best.end };
}

export interface SaidTurn {
  idx: number;
  speaker: 'resident' | 'patient';
  text: string;
}

/**
 * Finds a quote in the cited turn, or else in another turn by the same
 * speaker. Returns where it was said and the exact words, or null.
 */
export function findQuote(
  quote: string,
  turnIdx: number,
  turns: SaidTurn[],
  speaker: 'resident' | 'patient',
): { idx: number; quote: string } | null {
  const theirs = turns.filter((t) => t.speaker === speaker);
  const cited = theirs.find((t) => t.idx === turnIdx);
  const order = cited ? [cited, ...theirs.filter((t) => t !== cited)] : theirs;
  for (const t of order) {
    const m = matchQuote(quote, t.text);
    if (m) return { idx: t.idx, quote: m };
  }
  return null;
}

/** Quoted words inside a note or summary (two words or more). */
export function inlineQuotes(text: string): { quote: string; before: string }[] {
  const out: { quote: string; before: string }[] = [];
  const re = /[“"]([^”"]{3,300})[”"]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (wordsOf(m[1]!).length < 2) continue;
    out.push({ quote: m[1]!, before: text.slice(Math.max(0, m.index - 40), m.index) });
  }
  return out;
}

/**
 * Who a quote inside a note is attributed to, from the words just before it
 * ("you said", "Ray said"). null: either.
 */
export function speakerOf(before: string, patientFirstName: string): 'resident' | 'patient' | null {
  const b = before.toLowerCase();
  const name = patientFirstName.toLowerCase();
  if (
    (name && b.includes(name)) ||
    /\b(he|she|they|patient)\b[^.]*\b(said|says|asked|mentioned|told|shared)\b/.test(b)
  )
    return 'patient';
  if (/\byou\b[^.]*$/.test(b)) return 'resident';
  return null;
}

/** Every quote inside a note or summary must have been said (by the speaker it names). */
export function badInlineQuotes(
  text: string,
  turns: SaidTurn[],
  patientFirstName: string,
): string[] {
  return inlineQuotes(text)
    .filter(({ quote, before }) => {
      const who = speakerOf(before, patientFirstName);
      const pool = who ? turns.filter((t) => t.speaker === who) : turns;
      return !pool.some((t) => matchQuote(quote, t.text));
    })
    .map((q) => q.quote);
}
