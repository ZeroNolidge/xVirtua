import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  createJargonMatcher,
  DEFAULT_SCORING_WEIGHTS,
  overallScore,
  RUBRIC_VERSION,
  scoreJargon,
  SEED_JARGON,
  tokenize,
  type CueResult,
  type CueScriptEntry,
  type JargonMetricScore,
  type JargonResult,
  type MetricScore,
  type Moment,
  type ScoreDoc,
  type ScoringWeights,
  type UnderstandingCheck,
} from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';
import { loadScenario } from '../session/scenario.js';
import { RUBRIC, SCORE_JSON_SCHEMA } from './rubric.js';

export const SCORING_MODEL = 'claude-opus-5-5';

export interface Turn {
  idx: number;
  speaker: 'resident' | 'patient';
  text: string;
  cueId?: string | null;
  askedQuestion?: boolean;
  responseGapMs?: number | null;
  understandingCheck?: UnderstandingCheck;
  words?: number;
}

// ---------- Claude output ----------

const ev = z.object({ turnIdx: z.number().int(), quote: z.string(), note: z.string() });
const tti = z
  .object({ turnIdx: z.number().int(), original: z.string(), rewrite: z.string() })
  .nullable();
const metric = z.object({
  score: z.number(),
  summary: z.string(),
  evidence: z.array(ev),
  tryThisInstead: tti,
});
const momentZ = z.object({
  metric: z.enum(['jargon', 'clarity', 'empathy', 'cue']),
  turnIdx: z.number().int(),
  quote: z.string(),
  note: z.string(),
  rewrite: z.string().optional(),
});
export const claudeScoreSchema = z.object({
  jargonTryThisInstead: tti,
  clarity: metric,
  empathy: metric,
  cue: metric.extend({
    cueResults: z.array(
      z.object({
        cueId: z.string(),
        patientTurnIdx: z.number().int(),
        addressed: z.boolean(),
        residentTurnIdx: z.number().int().nullable(),
        quote: z.string().nullable(),
      }),
    ),
    steamrolls: z.array(
      z.object({ patientTurnIdx: z.number().int(), residentTurnIdx: z.number().int() }),
    ),
  }),
  highlight: momentZ,
  fixes: z.array(momentZ),
});
export type ClaudeScore = z.infer<typeof claudeScoreSchema>;

/** Sends the scoring prompt and returns Claude's raw JSON. */
export type Scorer = (system: string, user: string) => Promise<{ raw: string; model: string }>;

export function claudeScorer(apiKey: string): Scorer {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 110_000 });
  return async (system, user) => {
    const res = await client.beta.messages.create({
      model: SCORING_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
      output_config: {
        effort: 'medium',
        format: {
          type: 'json_schema',
          schema: SCORE_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
    if (res.stop_reason === 'refusal') throw new Error('Scoring declined');
    const raw = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { raw, model: res.model };
  };
}

// ---------- prompt ----------

const STOP = new Set(
  'what when where which that this have will would could should about your there their them they then than with from just like does doing been were okay yeah really'.split(
    ' ',
  ),
);
const keyWords = (t: string) => new Set(tokenize(t).filter((w) => w.length > 3 && !STOP.has(w)));

/**
 * Deterministic steamroll hint (PLAN §4): the patient asked a question and the
 * resident's next turn runs over 40 words without touching its key words.
 */
export function steamrollHints(
  turns: Turn[],
): { patientTurnIdx: number; residentTurnIdx: number }[] {
  const out: { patientTurnIdx: number; residentTurnIdx: number }[] = [];
  for (let i = 0; i < turns.length - 1; i++) {
    const p = turns[i]!;
    const r = turns[i + 1]!;
    if (p.speaker !== 'patient' || r.speaker !== 'resident' || !p.askedQuestion) continue;
    const words = r.words ?? tokenize(r.text).length;
    const q = keyWords(p.text);
    const overlap = [...keyWords(r.text)].some((w) => q.has(w));
    if (words > 40 && !overlap) out.push({ patientTurnIdx: p.idx, residentTurnIdx: r.idx });
  }
  return out;
}

export interface PromptInput {
  scenario: {
    title: string;
    residentTask: string;
    learningObjectives: string[];
    patientName: string;
  };
  cues: CueScriptEntry[];
  turns: Turn[];
  jargon: JargonResult;
}

export function buildScoringPrompt(p: PromptInput): { system: string; user: string } {
  const cueById = new Map(p.cues.map((c) => [c.id, c]));
  const firstName = p.scenario.patientName.split(' ')[0];
  const lines = p.turns.map((t) => {
    if (t.speaker === 'patient') {
      const tags: string[] = [];
      const cue = t.cueId ? cueById.get(t.cueId) : undefined;
      if (cue) tags.push(`CUE ${cue.id}: ${cue.cue}`);
      if (t.askedQuestion) tags.push('asked a question');
      return `[T${t.idx}] PATIENT${tags.length ? ` (${tags.join('; ')})` : ''}: ${t.text}`;
    }
    const tags: string[] = [];
    if (t.responseGapMs != null)
      tags.push(`began ~${Math.round(t.responseGapMs / 100) / 10}s after ${firstName} finished`);
    if (t.understandingCheck) tags.push(`understanding check: ${t.understandingCheck}`);
    return `[T${t.idx}] RESIDENT${tags.length ? ` (${tags.join('; ')})` : ''}: ${t.text}`;
  });
  const fired = p.turns.filter((t) => t.speaker === 'patient' && t.cueId && cueById.has(t.cueId));
  const cueBlock = fired.length
    ? fired
        .map((t) => {
          const c = cueById.get(t.cueId!)!;
          return `- ${c.id} at T${t.idx}: ${c.cue}. Expected response: ${c.expectedResidentResponse}`;
        })
        .join('\n')
    : '- (no scripted cues fired)';
  const jargonBlock = p.jargon.flagged.length
    ? p.jargon.flagged
        .map(
          (f) =>
            `- "${f.surfaces[0] ?? f.term}" (T${f.turns.join(', T')}) → plain: ${f.plain.join(' / ')}`,
        )
        .join('\n')
    : '- none';
  const hints = steamrollHints(p.turns);
  const user = `# Scenario
${p.scenario.title}. The resident's task: ${p.scenario.residentTask}
Learning objectives:
${p.scenario.learningObjectives.map((o) => `- ${o}`).join('\n')}

# Scripted cues that fired
${cueBlock}

# Jargon the app already flagged (scored separately; use it for fixes if it matters most)
${jargonBlock}

# Possible steamrolls (automatic hint, confirm or reject)
${hints.length ? hints.map((h) => `- patient T${h.patientTurnIdx} → resident T${h.residentTurnIdx}`).join('\n') : '- none'}

# Transcript
${lines.join('\n')}

Score this conversation using the rubric. Return JSON only.`;
  const system = `You are an experienced family medicine faculty member coaching a resident on patient communication. The patient is fictional. You score fairly and specifically, and you always back scores with exact quotes.\n\n${RUBRIC}`;
  return { system, user };
}

// ---------- quote validation ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Checks a quote against the cited resident turn. If it's verbatim in a
 * different resident turn, the turn number is corrected. Returns the turn it
 * was found in, or null.
 */
export function locateQuote(quote: string, turnIdx: number, turns: Turn[]): number | null {
  const q = norm(quote);
  if (!q) return null;
  const resident = turns.filter((t) => t.speaker === 'resident');
  const cited = resident.find((t) => t.idx === turnIdx);
  if (cited && norm(cited.text).includes(q)) return cited.idx;
  return resident.find((t) => norm(t.text).includes(q))?.idx ?? null;
}

export interface Validated {
  score: ClaudeScore;
  bad: string[];
}

/** Drops (and reports) any quote that isn't in the transcript. Fixes wrong turn numbers. */
export function validateQuotes(c: ClaudeScore, turns: Turn[]): Validated {
  const bad: string[] = [];
  const check = <T extends { turnIdx: number; quote: string }>(x: T, where: string): T | null => {
    const at = locateQuote(x.quote, x.turnIdx, turns);
    if (at === null) {
      bad.push(`${where}: "${x.quote}" (T${x.turnIdx})`);
      return null;
    }
    return { ...x, turnIdx: at };
  };
  const checkTti = (t: ClaudeScore['clarity']['tryThisInstead'], where: string) => {
    if (!t) return null;
    const r = check({ ...t, quote: t.original }, where);
    return r ? { turnIdx: r.turnIdx, original: t.original, rewrite: t.rewrite } : null;
  };
  const fixMetric = <M extends ClaudeScore['clarity']>(m: M, name: string): M => ({
    ...m,
    score: Math.round(Math.min(100, Math.max(0, m.score))),
    evidence: m.evidence
      .map((e, i) => check(e, `${name}.evidence[${i}]`))
      .filter((e) => e !== null),
    tryThisInstead: checkTti(m.tryThisInstead, `${name}.tryThisInstead`),
  });
  const score: ClaudeScore = {
    jargonTryThisInstead: checkTti(c.jargonTryThisInstead, 'jargonTryThisInstead'),
    clarity: fixMetric(c.clarity, 'clarity'),
    empathy: fixMetric(c.empathy, 'empathy'),
    cue: {
      ...fixMetric(c.cue, 'cue'),
      cueResults: c.cue.cueResults.map((r, i) => {
        if (!r.quote || r.residentTurnIdx === null) return { ...r, quote: null };
        const at = locateQuote(r.quote, r.residentTurnIdx, turns);
        if (at === null) bad.push(`cue.cueResults[${i}]: "${r.quote}"`);
        return at === null ? { ...r, quote: null } : { ...r, residentTurnIdx: at };
      }),
      steamrolls: c.cue.steamrolls,
    },
    highlight: c.highlight,
    fixes: c.fixes
      .slice(0, 2)
      .map((f, i) => check(f, `fixes[${i}]`))
      .filter((f) => f !== null),
  };
  const h = check(c.highlight, 'highlight');
  if (h) score.highlight = h;
  return { score, bad };
}

// ---------- assemble ----------

export function jargonMetric(
  j: JargonResult,
  turns: Turn[],
  rewrite: ClaudeScore['jargonTryThisInstead'],
): JargonMetricScore {
  const textOf = new Map(turns.map((t) => [t.idx, t.text]));
  const summary = !j.flagged.length
    ? j.explained.length
      ? 'No unexplained jargon, and you explained the medical words you used.'
      : 'No jargon flagged. Nice plain language.'
    : `${j.flagged.length} medical ${j.flagged.length === 1 ? 'word' : 'words'} went unexplained.`;
  return {
    score: j.score,
    summary,
    evidence: j.flagged.slice(0, 3).map((f) => ({
      turnIdx: f.turns[0]!,
      quote: f.surfaces[0] ?? f.term,
      note: `Try “${f.plain[0] ?? 'a plain word'}” instead${f.uses > 1 ? ` (used ${f.uses} times)` : ''}.`,
    })),
    tryThisInstead: rewrite && textOf.has(rewrite.turnIdx) ? rewrite : null,
    flagged: j.flagged.map((f) => ({
      term: f.surfaces[0] ?? f.term,
      plain: f.plain,
      uses: f.uses,
      turns: f.turns,
    })),
    explained: j.explained.map((e) => ({ term: e.term, turnIdx: e.turnIdx })),
  };
}

export function bestUnderstandingCheck(turns: Turn[]): UnderstandingCheck {
  const checks = turns.filter((t) => t.speaker === 'resident').map((t) => t.understandingCheck);
  if (checks.includes('teachback')) return 'teachback';
  if (checks.includes('weak')) return 'weak';
  return null;
}

export function assembleScore(args: {
  claude: ClaudeScore;
  jargon: JargonResult;
  turns: Turn[];
  cues: CueScriptEntry[];
  weights: ScoringWeights;
  needsReview: boolean;
  model: string;
  promptHash: string;
}): Omit<ScoreDoc, 'createdAt'> {
  const { claude: c, turns } = args;
  const cueById = new Map(args.cues.map((x) => [x.id, x]));
  const jargon = jargonMetric(args.jargon, turns, c.jargonTryThisInstead);
  const strip = (m: ClaudeScore['clarity']): MetricScore => ({
    score: m.score,
    summary: m.summary,
    evidence: m.evidence.slice(0, 3),
    tryThisInstead: m.tryThisInstead,
  });
  const cueResults: CueResult[] = c.cue.cueResults.map((r) => ({
    cueId: r.cueId,
    cue: cueById.get(r.cueId)?.cue ?? r.cueId,
    patientTurnIdx: r.patientTurnIdx,
    residentTurnIdx: r.residentTurnIdx,
    addressed: r.addressed,
    quote: r.quote,
  }));
  const metrics = {
    jargon,
    clarity: strip(c.clarity),
    empathy: strip(c.empathy),
    cue: { ...strip(c.cue), cueResults, steamrolls: c.cue.steamrolls },
  };
  const highlight: Moment | null =
    locateQuote(c.highlight.quote, c.highlight.turnIdx, turns) !== null
      ? {
          metric: c.highlight.metric,
          turnIdx: c.highlight.turnIdx,
          quote: c.highlight.quote,
          note: c.highlight.note,
        }
      : null;
  const fixes: Moment[] = c.fixes.slice(0, 2).map((f) => ({
    metric: f.metric,
    turnIdx: f.turnIdx,
    quote: f.quote,
    note: f.note,
    ...(f.rewrite ? { rewrite: f.rewrite } : {}),
  }));
  return {
    rubricVersion: RUBRIC_VERSION,
    overall: overallScore(
      {
        jargon: jargon.score,
        clarity: c.clarity.score,
        empathy: c.empathy.score,
        cue: c.cue.score,
      },
      args.weights,
    ),
    weights: args.weights,
    metrics,
    highlight,
    fixes,
    understandingCheck: bestUnderstandingCheck(turns),
    needsReview: args.needsReview,
    model: args.model,
    promptHash: args.promptHash,
  };
}

/** Runs Claude, validates quotes, retries once with the problems listed. */
export async function runScoring(
  scorer: Scorer,
  prompt: { system: string; user: string },
  turns: Turn[],
): Promise<{ claude: ClaudeScore; model: string; needsReview: boolean }> {
  let user = prompt.user;
  let last: { claude: ClaudeScore; model: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let parsed: ClaudeScore;
    let model: string;
    try {
      const r = await scorer(prompt.system, user);
      parsed = claudeScoreSchema.parse(JSON.parse(r.raw));
      model = r.model;
    } catch (e) {
      console.warn('scoring output invalid', e instanceof Error ? e.message : e);
      if (attempt === 0) continue;
      throw e;
    }
    const v = validateQuotes(parsed, turns);
    last = { claude: v.score, model };
    if (!v.bad.length) return { ...last, needsReview: false };
    user = `${prompt.user}\n\nYour previous answer quoted words that are not in the transcript:\n${v.bad.map((b) => `- ${b}`).join('\n')}\nQuote the resident's words exactly as written.`;
  }
  if (!last) throw new Error('Scoring failed');
  return { ...last, needsReview: true };
}

// ---------- callable ----------

const input = z.object({
  sessionId: z.string().min(1).max(64),
  /** Faculty only: score again even if a score exists for this rubric version. */
  rescore: z.boolean().nullish(),
});

const matcher = createJargonMatcher(SEED_JARGON);

/**
 * Scores a finished conversation (or returns the saved score). The resident
 * who owns it or faculty in the same program may call it. Ends a still-open
 * conversation first, so turns already done can always be scored.
 */
export async function scoreSession(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  scorer: Scorer,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { sessionId, rescore } = parse(input, data);
  const ref = db.doc(`sessions/${sessionId}`);
  const s = (await ref.get()).data();
  const isFaculty = caller.claims.role === 'faculty' && caller.claims.programId === s?.programId;
  if (!s || (s.uid !== caller.uid && !isFaculty))
    throw new HttpsError('not-found', 'Session not found.');

  const scoreRef = ref.collection('scores').doc(RUBRIC_VERSION);
  const existing = await scoreRef.get();
  if (existing.exists && !(rescore && isFaculty))
    return { score: existing.data() as ScoreDoc, cached: true };

  const turns = (await ref.collection('turns').orderBy('idx').get()).docs.map(
    (d) => d.data() as Turn,
  );
  const residentTurns = turns.filter((t) => t.speaker === 'resident');
  if (!residentTurns.length) return { score: null, cached: false, reason: 'no-turns' as const };

  if (s.status === 'live') {
    if (s.uid !== caller.uid)
      throw new HttpsError('failed-precondition', 'This conversation is still going.');
    const started = s.startedAt?.toMillis?.() ?? Date.now();
    await ref.update({
      status: 'ended',
      endedReason: 'scored-early',
      endedAt: FieldValue.serverTimestamp(),
      durationSec: Math.round((Date.now() - started) / 1000),
      pending: false,
    });
  }

  await consumeQuota(db, caller.uid, 'scoring');
  const sc = await loadScenario(db, s.scenarioId, s.scenarioVersion);
  if (!sc) throw new HttpsError('not-found', 'Scenario not found.');
  const program = (await db.doc(`programs/${s.programId}`).get()).data();
  const weights =
    (program?.scoringWeights as ScoringWeights | undefined) ?? DEFAULT_SCORING_WEIGHTS;

  const jargon = scoreJargon(
    residentTurns.map((t) => ({ idx: t.idx, text: t.text })),
    matcher,
  );
  const prompt = buildScoringPrompt({
    scenario: {
      title: sc.briefing.title,
      residentTask: sc.briefing.residentTask,
      learningObjectives: sc.briefing.learningObjectives,
      patientName: sc.briefing.persona.name,
    },
    cues: sc.script.cueScript,
    turns,
    jargon,
  });
  const promptHash = createHash('sha256')
    .update(prompt.system)
    .update(JSON.stringify(SCORE_JSON_SCHEMA))
    .digest('hex')
    .slice(0, 16);

  let result;
  try {
    result = await runScoring(scorer, prompt, turns);
  } catch (e) {
    console.error('scoring failed', e);
    throw new HttpsError(
      'unavailable',
      'Feedback isn’t available right now. Please try again in a minute.',
    );
  }
  const doc = assembleScore({
    claude: result.claude,
    jargon,
    turns,
    cues: sc.script.cueScript,
    weights,
    needsReview: result.needsReview,
    model: result.model,
    promptHash,
  });
  const full: ScoreDoc = { ...doc, createdAt: new Date().toISOString() };
  await scoreRef.set(full);
  await ref.update({ latestRubricVersion: RUBRIC_VERSION, overall: doc.overall });
  return { score: full, cached: false };
}
