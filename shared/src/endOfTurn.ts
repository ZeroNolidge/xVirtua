/**
 * How long to wait after the resident stops talking before sending their
 * turn. People pause mid-thought ("so the plan is, um…"), so a sentence that
 * sounds unfinished waits much longer than one that sounds done.
 * (Speech-to-text has already waited ~0.9 s of silence before this starts.)
 */
export const END_OF_TURN_MS = {
  /** Sounds finished: "…we'll check it again next month." */
  done: 2200,
  /** A question to the patient: they'd expect an answer. */
  question: 1500,
  /** A short finished remark ("That's understandable.") is often a lead-in. */
  shortDone: 3500,
  /** Trails off: "…and", "um", a comma. */
  unfinished: 4500,
};

const TRAILING =
  /\b(and|but|so|or|because|cause|um+|uh+|er+|hmm+|like|if|then|the|a|an|to|with|which|that|when|while|of|about|for|your|my|our|is|are|was|we|you|i|it's|just|maybe|also|plus|well|okay so|actually)$/;

export function endOfTurnDelayMs(text: string): number {
  const t = text.trim().toLowerCase();
  if (!t) return END_OF_TURN_MS.unfinished;
  if (/[,;:…\-—–]$/.test(t) || /\.\.\.$/.test(t)) return END_OF_TURN_MS.unfinished;
  const bare = t.replace(/[.!?"'”’)]+$/, '').trim();
  if (TRAILING.test(bare)) return END_OF_TURN_MS.unfinished;
  if (/\?["'”’)]*$/.test(t)) return END_OF_TURN_MS.question;
  // No end punctuation at all usually means the speaker stopped mid-sentence.
  if (!/[.!?]["'”’)]*$/.test(t)) return END_OF_TURN_MS.unfinished;
  return bare.split(/\s+/).length < 8 ? END_OF_TURN_MS.shortDone : END_OF_TURN_MS.done;
}
