import type { NonverbalCue } from '@plainspeak/shared';

/**
 * GPT-Live sends no body language, so we pick it from what the patient just
 * said. Simple word patterns, checked in order; most lines get none.
 */
const GUARDED: [RegExp, NonverbalCue][] = [
  [/\b(dad|father|pop|stroke)\b/i, 'avoid_eye_contact'],
  [/\b(license|licence|cdl|truck|trucking|job|work|drive|driving|card|route)\b/i, 'fidget'],
  [/\b(feel fine|don'?t see|why would|what'?s the rush|really\?|not sure about)\b/i, 'frown'],
  [/(\b(i don'?t know|i guess|i mean|hmm+|not sure)\b|\.\.\.|…)/i, 'look_away'],
];
const AT_EASE: [RegExp, NonverbalCue][] = [
  [/\b(thanks|thank you|appreciate|that helps|feel better|good to know|relieved)\b/i, 'smile'],
  [/\b(okay|ok|alright|all right|makes sense|sounds good|got it|sure|yeah)\b/i, 'nod'],
];

export function cueForWords(text: string, mood: 'guarded' | 'at_ease'): NonverbalCue | null {
  for (const [re, cue] of mood === 'guarded' ? GUARDED : AT_EASE) if (re.test(text)) return cue;
  return null;
}
