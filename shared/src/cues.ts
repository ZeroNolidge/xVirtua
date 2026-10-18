import type { CueScriptEntry } from './model.js';
import { tokenize, type JargonMatcher } from './jargon.js';

export type UnderstandingCheck = 'teachback' | 'weak' | null;

const TEACHBACK = [
  /\bin your own words\b/,
  /\b(tell|explain|walk) me (back )?(what|how)\b/,
  /\bcan you (tell|explain|repeat|walk) (me )?(back|that back)\b/,
  /\bwhat (will|would) you tell\b/,
  /\bto make sure i (explained|was clear|did a good job)\b/,
  /\bhow (will|would) you explain (this|it|that) to\b/,
  /\bwhat('s| is) your understanding\b/,
];
const WEAK = [
  /\bany questions\b/,
  /\bdo(es)? (that|this|it) make sense\b/,
  /\bmake sense\b/,
  /\b(do|did) you (understand|get (that|it))\b/,
  /\bwhat questions\b/,
  /\bquestions (for me|so far|about)\b/,
  /\bunderstand\?/,
  /\bsound (ok|okay|good)\b/,
  /\bdoes that sound\b/,
];

/**
 * D6: "Any questions?" counts weakly; teach-back ("tell me in your own words")
 * counts fully.
 */
export function detectUnderstandingCheck(text: string): UnderstandingCheck {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  if (TEACHBACK.some((r) => r.test(t))) return 'teachback';
  if (WEAK.some((r) => r.test(t))) return 'weak';
  return null;
}

export const wordCount = (text: string) => tokenize(text).length;

function mentions(text: string, topic: string): boolean {
  const toks = tokenize(text);
  const want = tokenize(topic);
  if (!want.length) return false;
  outer: for (let i = 0; i <= toks.length - want.length; i++) {
    for (let j = 0; j < want.length; j++) if (toks[i + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}

export interface CueState {
  /** How many times each cue has fired. */
  fired: Record<string, number>;
  /** Consecutive resident turns with no understanding check. */
  turnsWithoutCheck: number;
  /** Number of patient replies so far, not counting the opening line. */
  patientReplies: number;
}

export const initialCueState = (): CueState => ({
  fired: {},
  turnsWithoutCheck: 0,
  patientReplies: 0,
});

const STOP = new Set(
  'that this have will with from just like what when your they them then than about there their been were really going want dont'.split(
    ' ',
  ),
);
const keyWords = (t: string) => tokenize(t).filter((w) => w.length > 3 && !STOP.has(w));

/**
 * True if the patient has already said what this cue would say (most of the
 * line's key words appear in one earlier patient reply), e.g. the patient
 * brought up their dad's stroke on their own before the trigger word came up.
 */
export function cueAlreadyCovered(cue: CueScriptEntry, patientSaid: string[]): boolean {
  const want = [...new Set(keyWords(cue.performance.say))];
  if (want.length < 2) return false;
  return patientSaid.some((said) => {
    const have = new Set(keyWords(said));
    return want.filter((w) => have.has(w)).length / want.length >= 0.6;
  });
}

export interface CueDecision {
  cue: CueScriptEntry | null;
  next: CueState;
  /** Facts about this resident turn, kept for scoring. */
  turnFacts: { words: number; jargonCount: number; understandingCheck: UnderstandingCheck };
}

/**
 * Deterministic cue engine. Called once per resident turn, before the patient
 * replies. Fires at most one cue; earlier cues in the script win ties.
 * `turn_index` fires on the Nth patient reply or the first chance after it.
 */
export function decideCue(
  script: CueScriptEntry[],
  state: CueState,
  residentText: string,
  matcher: JargonMatcher,
  /** The patient's earlier replies, so a cue never repeats what they already said. */
  patientSaid: string[] = [],
): CueDecision {
  const words = wordCount(residentText);
  const jargonCount = matcher.find(residentText).filter((h) => !h.explained).length;
  const understandingCheck = detectUnderstandingCheck(residentText);
  const turnsWithoutCheck = understandingCheck ? 0 : state.turnsWithoutCheck + 1;
  const replyNumber = state.patientReplies + 1;

  let cue: CueScriptEntry | null = null;
  const fired = { ...state.fired };
  for (const c of script) {
    if ((fired[c.id] ?? 0) >= c.maxFires) continue;
    const t = c.trigger;
    const hit =
      (t.type === 'resident_turn_words_gt' && words > t.value) ||
      (t.type === 'jargon_in_turn_gte' && jargonCount >= t.value) ||
      (t.type === 'turn_index' && replyNumber >= t.value) ||
      (t.type === 'topic_mentioned' && t.topics.some((topic) => mentions(residentText, topic))) ||
      (t.type === 'no_understanding_check_for_turns' && turnsWithoutCheck >= t.value);
    if (!hit) continue;
    if (cueAlreadyCovered(c, patientSaid)) {
      // Already said it unprompted: count it as used and don't repeat it.
      fired[c.id] = c.maxFires;
      continue;
    }
    cue = c;
    break;
  }

  if (cue) fired[cue.id] = (fired[cue.id] ?? 0) + 1;
  return {
    cue,
    next: {
      fired,
      // A repeat-question style cue resets the counter so it doesn't fire every turn.
      turnsWithoutCheck:
        cue?.trigger.type === 'no_understanding_check_for_turns' ? 0 : turnsWithoutCheck,
      patientReplies: replyNumber,
    },
    turnFacts: { words, jargonCount, understandingCheck },
  };
}
