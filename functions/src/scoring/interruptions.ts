/**
 * Which cut-offs count against the resident. A short "sorry", "mm-hm" or
 * "right" over the patient is how people listen, not an interruption. A cut-off
 * where the patient had barely started is the app's timing (it began the reply
 * while the resident was still talking), not the resident's.
 */
import type { Moment } from '@plainspeak/shared';

export type CutKind = 'counts' | 'backchannel' | 'app';

interface T {
  idx: number;
  speaker: 'resident' | 'patient';
  text: string;
  interrupted?: boolean;
  heardText?: string;
}

const BACKCHANNEL = new Set(
  'sorry mm mmm hm hmm mhm mm-hm mm-hmm uh-huh uhhuh right okay ok yeah yes yep sure oh ah i see go on gotcha got it true'.split(
    ' ',
  ),
);
const words = (s: string) => s.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];

/** "Sorry", "mm-hm", "right, go on": listening sounds, never a real cut-in. */
export function isBackchannel(text: string): boolean {
  const w = words(text);
  return w.length > 0 && w.length <= 4 && w.every((x) => BACKCHANNEL.has(x));
}

/** The patient had said fewer words than this when cut off: the app's timing. */
export const MIN_HEARD_WORDS = 2;

/** How each cut-off patient turn should be treated, by its turn number. */
export function classifyCutoffs(turns: T[]): Map<number, CutKind> {
  const out = new Map<number, CutKind>();
  turns.forEach((t, i) => {
    if (t.speaker !== 'patient' || !t.interrupted) return;
    const next = turns.slice(i + 1).find((x) => x.speaker === 'resident');
    if (words(t.heardText ?? '').length < MIN_HEARD_WORDS) out.set(t.idx, 'app');
    else if (next && isBackchannel(next.text)) out.set(t.idx, 'backchannel');
    else out.set(t.idx, 'counts');
  });
  return out;
}

const ABOUT_INTERRUPTING =
  /\b(cut (him|her|them|ray|the patient|you)? ?off|cutting (him|her|them)? ?off|talk(ed|ing)? over|interrupt\w*|jump(ed)? in|cut in)\b/i;

/** A note about the resident talking over the patient. */
export const isInterruptionNote = (note: string) => ABOUT_INTERRUPTING.test(note);

/**
 * The resident turn that cut in on each patient turn whose cut-off counts,
 * with what the patient got out (the worry that was cut off).
 */
export function countingCutIns(turns: T[]): Map<number, string> {
  const kinds = classifyCutoffs(turns);
  const out = new Map<number, string>();
  turns.forEach((t, i) => {
    if (kinds.get(t.idx) !== 'counts') return;
    const next = turns.slice(i + 1).find((x) => x.speaker === 'resident');
    if (next) out.set(next.idx, (t.heardText ?? '').trim());
  });
  return out;
}

/** A way back after cutting in: names what the patient was saying. */
export function wayBack(heard: string): string {
  const tail = heard
    .split(/\s+/)
    .slice(-8)
    .join(' ')
    .replace(/[.,;:!?—-]+$/, '');
  return tail
    ? `Sorry, I jumped in. You were saying "${tail}…" — please go on.`
    : 'Sorry, I jumped in. Please go on.';
}

/**
 * At most one interruption note per session, and only about a cut-off that
 * counts. The one kept (a fix if there is one) always offers a way back.
 * Returns the kept fixes and which evidence notes to drop.
 */
export function limitInterruptionNotes<F extends Moment>(
  fixes: F[],
  evidence: { key: string; turnIdx: number; note: string }[],
  turns: T[],
): { fixes: F[]; dropEvidence: Set<string> } {
  const cutIns = countingCutIns(turns);
  let used = false;
  const keptFixes: F[] = [];
  for (const f of fixes) {
    if (!isInterruptionNote(f.note)) {
      keptFixes.push(f);
      continue;
    }
    if (used || !cutIns.has(f.turnIdx)) continue;
    used = true;
    keptFixes.push(f.rewrite ? f : { ...f, rewrite: wayBack(cutIns.get(f.turnIdx)!) });
  }
  const dropEvidence = new Set<string>();
  for (const e of evidence) {
    if (!isInterruptionNote(e.note)) continue;
    if (used || !cutIns.has(e.turnIdx)) dropEvidence.add(e.key);
    else used = true;
  }
  return { fixes: keptFixes, dropEvidence };
}
