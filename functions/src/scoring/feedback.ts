import {
  bandFor,
  METRICS,
  trendFor,
  type AreaFeedback,
  type Metric,
  type MetricScore,
  type Moment,
  type ResidentFeedback,
  type ScoreDoc,
} from '@plainspeak/shared';
import { rewriteProblems } from './rewriteCheck.js';

type Scored = Omit<ScoreDoc, 'createdAt'>;

/**
 * Two fixes from two different areas, each with a rewrite. If scoring
 * returned two from the same area, one without a rewrite, or fewer than two,
 * the gap is filled with the top suggestion from the next-weakest area.
 */
export function distinctFixes(s: Pick<Scored, 'fixes' | 'metrics'>): Moment[] {
  const out: Moment[] = [];
  const used = new Set<Metric>();
  for (const f of s.fixes) {
    if (out.length === 2) break;
    if (used.has(f.metric)) continue;
    // Every fix comes with something to say instead; borrow the area's own
    // rewrite when it's about the same line.
    const t = s.metrics[f.metric].tryThisInstead;
    const rewrite = f.rewrite ?? (t && t.turnIdx === f.turnIdx ? t.rewrite : undefined);
    if (!rewrite) continue;
    out.push({ ...f, rewrite });
    used.add(f.metric);
  }
  if (out.length < 2) {
    const weakestFirst = [...METRICS].sort((a, b) => s.metrics[a].score - s.metrics[b].score);
    for (const m of weakestFirst) {
      if (out.length === 2) break;
      const t = s.metrics[m].tryThisInstead;
      if (used.has(m) || !t) continue;
      out.push({
        metric: m,
        turnIdx: t.turnIdx,
        quote: t.original,
        note: s.metrics[m].summary,
        rewrite: t.rewrite,
      });
      used.add(m);
    }
  }
  return out;
}

/**
 * Flags rewrites that add licensing/legal claims, drug names or numbers the
 * resident never said, and removes them from what the resident sees.
 */
export function checkRewrites(s: Scored, residentSaid: string): Scored {
  const flags: NonNullable<ScoreDoc['rewriteFlags']> = [];
  const ok = (where: string, rewrite: string | undefined) => {
    if (!rewrite) return true;
    const reasons = rewriteProblems(rewrite, residentSaid);
    if (reasons.length) flags.push({ where, rewrite, reasons });
    return !reasons.length;
  };
  const metrics = { ...s.metrics };
  for (const m of METRICS) {
    const t = metrics[m].tryThisInstead;
    if (t && !ok(`${m}.tryThisInstead`, t.rewrite))
      metrics[m] = { ...metrics[m], tryThisInstead: null } as never;
  }
  const fixes = s.fixes.map((f, i) => {
    if (ok(`fixes[${i}]`, f.rewrite)) return f;
    const { rewrite: _drop, ...rest } = f;
    return rest;
  });
  return {
    ...s,
    metrics,
    fixes,
    rewriteFlags: flags,
    needsReview: s.needsReview || flags.length > 0,
  };
}

const area = (m: MetricScore): AreaFeedback => ({
  band: bandFor(m.score),
  summary: m.summary,
  evidence: m.evidence,
  tryThisInstead: m.tryThisInstead,
});

/** The resident's copy: words and trend only, no 0–100 numbers. */
export function toResidentFeedback(s: ScoreDoc, previousOverall: number | null): ResidentFeedback {
  const { jargon, clarity, empathy, cue } = s.metrics;
  return {
    rubricVersion: s.rubricVersion,
    overall:
      s.overall === null
        ? null
        : { band: bandFor(s.overall), trend: trendFor(s.overall, previousOverall) },
    highlight: s.highlight,
    fixes: s.fixes,
    areas: {
      jargon: {
        ...area(jargon),
        flagged: jargon.flagged.map((f) => ({ term: f.term, plain: f.plain, uses: f.uses })),
        explained: jargon.explained.map((e) => ({ term: e.term })),
      },
      clarity: area(clarity),
      empathy: area(empathy),
      cue: {
        ...area(cue),
        cueResults: cue.cueResults.map((c) => ({
          cue: c.cue,
          addressed: c.addressed,
          quote: c.quote,
        })),
      },
    },
    createdAt: s.createdAt,
  };
}

const clip = (t: string, max = 160) => {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
};

/** Adds what the patient said just before each quoted line ("Before this, Ray said…"). */
export function withContext<S extends Pick<Scored, 'highlight' | 'fixes'>>(
  s: S,
  turns: { idx: number; speaker: 'resident' | 'patient'; text: string }[],
): S {
  const before = (m: Moment): Moment => {
    const prev = turns
      .filter((t) => t.speaker === 'patient' && t.idx < m.turnIdx && t.text.trim())
      .at(-1);
    return prev ? { ...m, before: clip(prev.text) } : m;
  };
  return {
    ...s,
    highlight: s.highlight ? before(s.highlight) : null,
    fixes: s.fixes.map(before),
  };
}
