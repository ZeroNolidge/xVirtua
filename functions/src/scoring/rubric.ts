import { RUBRIC_VERSION } from '@plainspeak/shared';

/**
 * Rubric for the three Claude-scored metrics. Changing this text means a new
 * RUBRIC_VERSION, so old and new scores never get mixed on a trend line.
 */
export const RUBRIC = `Rubric version ${RUBRIC_VERSION}. Score each metric 0–100.

## Logical clarity
Did the resident explain in an order a patient can follow, in small chunks, and check that the patient understood?
- Good order (a guideline, not a script): what it is → why it matters for this patient → what we'll do → what the patient does next.
- Short sentences and one idea at a time. Numbers are explained ("130 over 85 is a little high").
- Check for understanding: teach-back ("Can you tell me in your own words…") earns full credit. "Any questions?" or "Does that make sense?" earns only partial credit. No check at all costs the most.
Anchors: 90+ clear order, chunked, teach-back used. 70s mostly clear, weak or late check. 50s jumbled order or long monologues, no real check. Below 40 hard to follow throughout.

## Empathy
Did the resident notice and respond to the patient's feelings and situation, in words?
- Names or acknowledges emotion ("That sounds scary"), validates, normalizes, shows partnership ("We'll figure this out together").
- Asks about the patient's worries, values or life (job, family, cost) and uses the answer.
- Warm, unhurried tone in the words chosen. Avoids blaming or lecturing.
Anchors: 90+ repeated, specific empathy tied to what the patient said. 70s some empathy, generic or brief. 50s mostly task-focused, misses emotional openings. Below 40 dismissive or lecturing.

## Cue responsiveness
Scripted cues are moments where the patient signals something (confusion, worry, a hint about a hidden concern). A cue is "addressed" if the resident's NEXT turn responds to it in the way described by its expected response (it need not match word for word).
- Steamrolling: the patient asked a question or showed a cue, and the resident's next turn ignored it and kept going with their own agenda.
- Talking over the patient: lines marked "cut off" mean the resident spoke while the patient was still talking. Count it against cue responsiveness when it cut off a question, a worry or an emotional moment and the resident carried on with their own agenda. A brief, responsive overlap (e.g. "I'm sorry—" when the patient is upset, or answering the question they were asking) is natural and fine.
- Timing: response timing shown in the transcript already excludes any time the resident spent waiting on the app (the patient "thinking" or the voice loading). Never count that waiting as the resident's silence or delay, and don't penalize a thoughtful pause.
Anchors: 90+ every cue caught and explored. 70s most cues caught, one missed or brushed off. 50s half missed or a clear steamroll. Below 40 most cues ignored.

## Evidence rules (strict)
- Quote the resident's words EXACTLY as they appear in the transcript line you cite (a short phrase or sentence, max 25 words). Cite that line's turn number.
- Only quote RESIDENT turns as evidence, highlights, fixes and rewrites. Cue results cite the resident turn that responded.
- Every "rewrite" is one or two sentences the resident could say instead, in plain, warm language at about a 6th-grade reading level. When no understanding check was done, the top rewrite should model teach-back.
- A rewrite changes HOW the resident said something, never WHAT is medically or legally true. Use only facts the resident already said in the conversation. Never add new clinical facts (diagnoses, drug names, doses, test values, risks, timelines), legal facts, or licensing / driving / work-permit claims. If a better answer would need a fact the resident didn't give, rewrite toward asking, acknowledging, or checking understanding instead (e.g. "Let's look at what that means for your job together").
- Coaching tone: never "wrong", "bad" or "fail". Notes are one short sentence each.

## Highlight and fixes
- highlight: the single best moment in the conversation, from any metric.
- fixes: exactly 2 when possible, most important first, from TWO DIFFERENT metrics (never the same metric twice; jargon counts as a metric). Each has a rewrite; the first one is shown as "Try saying this instead".`;

const moment = (withRewrite: boolean) => ({
  type: 'object',
  additionalProperties: false,
  required: ['metric', 'turnIdx', 'quote', 'note', ...(withRewrite ? ['rewrite'] : [])],
  properties: {
    metric: { type: 'string', enum: ['jargon', 'clarity', 'empathy', 'cue'] },
    turnIdx: { type: 'integer' },
    quote: { type: 'string' },
    note: { type: 'string' },
    ...(withRewrite ? { rewrite: { type: 'string' } } : {}),
  },
});

const metric = (extra: Record<string, unknown> = {}, extraRequired: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  required: ['score', 'summary', 'evidence', 'tryThisInstead', ...extraRequired],
  properties: {
    score: { type: 'integer', description: '0–100' },
    summary: { type: 'string', description: 'One plain sentence for the resident.' },
    evidence: {
      type: 'array',
      description: '1–3 quotes that justify the score.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['turnIdx', 'quote', 'note'],
        properties: {
          turnIdx: { type: 'integer' },
          quote: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    tryThisInstead: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['turnIdx', 'original', 'rewrite'],
      properties: {
        turnIdx: { type: 'integer' },
        original: { type: 'string' },
        rewrite: { type: 'string' },
      },
    },
    ...extra,
  },
});

export const SCORE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['jargonTryThisInstead', 'clarity', 'empathy', 'cue', 'highlight', 'fixes'],
  properties: {
    jargonTryThisInstead: {
      type: ['object', 'null'],
      description:
        'If any jargon was flagged: the resident line with the worst jargon, rewritten in plain words.',
      additionalProperties: false,
      required: ['turnIdx', 'original', 'rewrite'],
      properties: {
        turnIdx: { type: 'integer' },
        original: { type: 'string' },
        rewrite: { type: 'string' },
      },
    },
    clarity: metric(),
    empathy: metric(),
    cue: metric(
      {
        cueResults: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['cueId', 'patientTurnIdx', 'addressed', 'residentTurnIdx', 'quote'],
            properties: {
              cueId: { type: 'string' },
              patientTurnIdx: { type: 'integer' },
              addressed: { type: 'boolean' },
              residentTurnIdx: { type: ['integer', 'null'] },
              quote: { type: ['string', 'null'] },
            },
          },
        },
        steamrolls: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['patientTurnIdx', 'residentTurnIdx'],
            properties: {
              patientTurnIdx: { type: 'integer' },
              residentTurnIdx: { type: 'integer' },
            },
          },
        },
      },
      ['cueResults', 'steamrolls'],
    ),
    highlight: moment(false),
    fixes: { type: 'array', items: moment(true), description: 'At most 2.' },
  },
} as const;
