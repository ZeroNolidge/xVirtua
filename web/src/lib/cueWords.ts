import { MOODS, type Mood, type NonverbalCue } from '@plainspeak/shared';

/** A character's own word patterns (from their manifest): [pattern, cue], checked first. */
export type CueRules = [string, NonverbalCue][];

/**
 * GPT-Live sends no body language, so we pick it from what the patient just
 * said. Simple word patterns, checked in order; most lines get none. Each
 * character adds their own (Ray: his dad, his truck licence) in their
 * manifest; these general ones come after.
 */
const GUARDED: [RegExp, NonverbalCue][] = [
  [/\b(feel fine|don'?t see|why would|what'?s the rush|really\?|not sure about)\b/i, 'frown'],
  [/(\b(i don'?t know|i guess|i mean|hmm+|not sure)\b|\.\.\.|…)/i, 'look_away'],
];
const AT_EASE: [RegExp, NonverbalCue][] = [
  [/\b(thanks|thank you|appreciate|that helps|feel better|good to know|relieved)\b/i, 'smile'],
  [/\b(okay|ok|alright|all right|makes sense|sounds good|got it|sure|yeah)\b/i, 'nod'],
];

export function cueForWords(
  text: string,
  mood: Mood,
  own: CueRules = [],
): NonverbalCue | null {
  for (const [pattern, cue] of own) {
    try {
      if (new RegExp(pattern, 'i').test(text)) return cue;
    } catch {
      // A bad pattern in a manifest: skip it.
    }
  }
  // Upset and guarded share the wary patterns; at ease and happy the warm ones.
  const wary = MOODS.indexOf(mood) <= MOODS.indexOf('guarded');
  for (const [re, cue] of wary ? GUARDED : AT_EASE) if (re.test(text)) return cue;
  return null;
}
