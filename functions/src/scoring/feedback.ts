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
 * Two fixes from two different areas. If scoring returned two from the same
 * area (or fewer than two), the second becomes the top suggestion from the
 * next-weakest area.
 */
export function distinctFixes(s: Pick<Scored, 'fixes' | 'metrics'>): Moment[] {
  const out: Moment[] = [];
  const used = new Set<Metric>();
  for (const f of s.fixes) {
    if (out.length === 2) break;
    if (used.has(f.metric)) continue;
    out.push(f);
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
