import { JARGON_SOURCE } from './jargon-data.js';

export const JARGON_CATEGORIES = [
  'general',
  'condition',
  'body',
  'test',
  'med',
  'treatment',
  'abbrev',
] as const;
export type JargonCategory = (typeof JARGON_CATEGORIES)[number];

export interface JargonTerm {
  /** Stable id (slug of the term). */
  id: string;
  term: string;
  variants: string[];
  plain: string[];
  category: JargonCategory;
  /** True when using the term is fine if the resident explains it nearby. */
  allowedIfExplained: boolean;
  note?: string;
  /** null = shared by all programs. */
  programId?: string | null;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function parseJargonSource(src: string): JargonTerm[] {
  const out: JargonTerm[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [term = '', plain = '', variants = '', category = '', flag = ''] = line.split('|');
    out.push({
      id: slugify(term),
      term: term.trim(),
      plain: plain
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean),
      variants: variants
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      category: category.trim() as JargonCategory,
      allowedIfExplained: flag.trim() === 'x',
      programId: null,
    });
  }
  return out;
}

/** The seed dictionary (draft, for faculty review). */
export const SEED_JARGON: JargonTerm[] = parseJargonSource(JARGON_SOURCE);

// ---------- normalization ----------

/** Lowercase, unify apostrophes/hyphens, drop periods inside abbreviations. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1') // b.i.d. -> bi.d. -> handled below
    .replace(/\b([a-z])\.(?=[a-z]\b)/g, '$1')
    .replace(/\b([a-z]{1,3})\.(?=\s|$|[,;!?])/g, '$1')
    .replace(/[-–—]/g, ' ');
}

export function tokenize(text: string): string[] {
  return normalize(text).match(/[a-z0-9'/]+/g) ?? [];
}

const phraseTokens = (s: string) => tokenize(s);

/** All surface forms for a term, as token lists (adds simple plurals). */
function formsOf(t: JargonTerm): string[][] {
  const set = new Set<string>();
  for (const f of [t.term, ...t.variants]) {
    const toks = phraseTokens(f);
    if (!toks.length) continue;
    set.add(toks.join(' '));
    const last = toks[toks.length - 1]!;
    if (/^[a-z]{3,}$/.test(last) && !last.endsWith('s')) {
      set.add([...toks.slice(0, -1), last + 's'].join(' '));
      if (/(ch|sh|x|z)$/.test(last)) set.add([...toks.slice(0, -1), last + 'es'].join(' '));
    }
  }
  return [...set].map((s) => s.split(' '));
}

// ---------- matching ----------

export interface JargonHit {
  termId: string;
  term: string;
  plain: string[];
  /** Surface text as matched (normalized). */
  surface: string;
  turnIdx: number;
  tokenIdx: number;
  explained: boolean;
}

export interface JargonMatcher {
  find(text: string, turnIdx?: number): JargonHit[];
}

const MARKERS_AFTER = [
  'which means',
  'that means',
  'means',
  'meaning',
  'in other words',
  'basically',
  "that's when",
  "it's when",
  'is when',
  'that is',
  'which is',
  'also called',
  'or',
].map(phraseTokens);
const MARKERS_BEFORE = ['what we call', 'we call', 'called', 'known as', "it's called"].map(
  phraseTokens,
);

function indexOfPhrase(tokens: string[], phrase: string[], from: number, to: number): number {
  const end = Math.min(to, tokens.length - phrase.length);
  for (let i = Math.max(0, from); i <= end; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++)
      if (tokens[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    if (ok) return i;
  }
  return -1;
}

export function createJargonMatcher(terms: JargonTerm[]): JargonMatcher {
  // Longest forms first so "high blood pressure" style phrases win over single words.
  const forms = terms
    .flatMap((t) => formsOf(t).map((toks) => ({ t, toks, plain: t.plain.map(phraseTokens) })))
    .sort((a, b) => b.toks.length - a.toks.length);
  const byFirst = new Map<string, typeof forms>();
  for (const f of forms) {
    const k = f.toks[0]!;
    if (!byFirst.has(k)) byFirst.set(k, []);
    byFirst.get(k)!.push(f);
  }

  return {
    find(text, turnIdx = 0) {
      const tokens = tokenize(text);
      const hits: JargonHit[] = [];
      for (let i = 0; i < tokens.length;) {
        const cands = byFirst.get(tokens[i]!);
        const m = cands?.find((f) => f.toks.every((tok, j) => tokens[i + j] === tok));
        if (!m) {
          i++;
          continue;
        }
        const end = i + m.toks.length;
        let explained = false;
        if (m.t.allowedIfExplained) {
          const near = m.plain.some(
            (p) => p.length > 0 && indexOfPhrase(tokens, p, i - 12, end + 12) !== -1,
          );
          const after = MARKERS_AFTER.some((p) => indexOfPhrase(tokens, p, end, end + 2) !== -1);
          const before = MARKERS_BEFORE.some(
            (p) => indexOfPhrase(tokens, p, i - p.length - 1, i - p.length) !== -1,
          );
          explained = near || after || before;
        }
        hits.push({
          termId: m.t.id,
          term: m.t.term,
          plain: m.t.plain,
          surface: m.toks.join(' '),
          turnIdx,
          tokenIdx: i,
          explained,
        });
        i = end;
      }
      return hits;
    },
  };
}

// ---------- scoring (deterministic metric 1) ----------

export interface JargonFlag {
  termId: string;
  term: string;
  plain: string[];
  uses: number;
  /** Turns where it was used without explanation. */
  turns: number[];
  surfaces: string[];
}

export interface JargonResult {
  score: number;
  flagged: JargonFlag[];
  /** Terms the resident used AND explained. Shown as wins. */
  explained: { termId: string; term: string; turnIdx: number }[];
}

/**
 * 100 − 8 per unique unexplained term − 2 per repeat use, floored at 0.
 * Once a term is explained in the conversation, later uses are fine.
 */
export function scoreJargon(
  residentTurns: { idx: number; text: string }[],
  matcher: JargonMatcher,
): JargonResult {
  const explainedIds = new Set<string>();
  const explained: JargonResult['explained'] = [];
  const flags = new Map<string, JargonFlag>();
  for (const turn of residentTurns) {
    for (const h of matcher.find(turn.text, turn.idx)) {
      if (h.explained && !explainedIds.has(h.termId)) {
        explainedIds.add(h.termId);
        explained.push({ termId: h.termId, term: h.term, turnIdx: turn.idx });
      }
      if (h.explained || explainedIds.has(h.termId)) continue;
      const f = flags.get(h.termId) ?? {
        termId: h.termId,
        term: h.term,
        plain: h.plain,
        uses: 0,
        turns: [],
        surfaces: [],
      };
      f.uses++;
      if (!f.turns.includes(turn.idx)) f.turns.push(turn.idx);
      if (!f.surfaces.includes(h.surface)) f.surfaces.push(h.surface);
      flags.set(h.termId, f);
    }
  }
  const flagged = [...flags.values()];
  const repeats = flagged.reduce((n, f) => n + (f.uses - 1), 0);
  const score = Math.max(0, 100 - 8 * flagged.length - 2 * repeats);
  return { score, flagged, explained };
}

// ---------- lookup ----------

/**
 * Instant search for the "plain word" helper. Matches the term, variants
 * and plain words. Exact > prefix > word-prefix > substring.
 */
export function searchJargon(terms: JargonTerm[], query: string, limit = 20): JargonTerm[] {
  const q = tokenize(query).join(' ');
  if (!q) return [];
  const scored: { t: JargonTerm; s: number }[] = [];
  for (const t of terms) {
    let best = 0;
    const fields: [string, number][] = [
      ...[t.term, ...t.variants].map((f) => [tokenize(f).join(' '), 1] as [string, number]),
      ...t.plain.map((p) => [tokenize(p).join(' '), 0.6] as [string, number]),
    ];
    for (const [f, w] of fields) {
      let s = 0;
      if (f === q) s = 100;
      else if (f.startsWith(q)) s = 80 - Math.min(20, f.length - q.length);
      else if (f.split(' ').some((word) => word.startsWith(q))) s = 50;
      else if (q.length >= 3 && f.includes(q)) s = 30;
      best = Math.max(best, s * w);
    }
    if (best > 0) scored.push({ t, s: best });
  }
  scored.sort((a, b) => b.s - a.s || a.t.term.localeCompare(b.t.term));
  return scored.slice(0, limit).map((x) => x.t);
}
