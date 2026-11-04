export interface TranscriptEvent {
  /** Partial text while the resident is still talking. */
  kind: 'partial' | 'final';
  text: string;
  /** ms since session start */
  tStartMs: number;
  tEndMs: number;
}

/** Streaming speech-to-text (v1: OpenAI Realtime, transcription-only). */
export interface SttProvider {
  start(mic: unknown, onEvent: (e: TranscriptEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

/** Server-side text-to-speech (v1: Cartesia Sonic-3). */
export interface TtsProvider {
  synthesize(text: string, delivery: import('./patient.js').Delivery): AsyncIterable<Uint8Array>;
}

/**
 * Speech clarity: how clearly the transcriber caught the resident's words,
 * from its own confidence in each word. Mumbling lowers it; so can a poor
 * microphone, a noisy room or a strong accent, so it's shown with that
 * caveat and kept out of the overall score. Only counts are stored.
 */
export interface SpeechStats {
  /** Words the transcriber heard. */
  words: number;
  /** Of those, the ones it was confident about. */
  clear: number;
}

/** A word counts as heard clearly at this confidence or above. */
export const CLEAR_WORD_CONFIDENCE = 0.8;
/** Fewer words than this: too little to say. */
export const MIN_WORDS_FOR_CLARITY = 30;

/**
 * Counts words and clearly heard words in one transcription's per-token
 * confidence (log probabilities). A word's confidence is its least
 * confident piece; punctuation alone isn't a word.
 */
export function tallyWords(logprobs: readonly { token: string; logprob: number }[]): SpeechStats {
  let words = 0;
  let clear = 0;
  let cur: number | null = null;
  const close = () => {
    if (cur === null) return;
    words++;
    if (cur >= CLEAR_WORD_CONFIDENCE) clear++;
    cur = null;
  };
  for (const { token, logprob } of logprobs) {
    if (!Number.isFinite(logprob)) continue;
    const p = Math.exp(Math.min(0, logprob));
    if (/^\s/.test(token)) close();
    if (!/[\p{L}\p{N}]/u.test(token)) continue;
    cur = cur === null ? p : Math.min(cur, p);
  }
  close();
  return { words, clear };
}

/** Share of words heard clearly, 0–100, or null when there's too little speech. */
export function speechClarityPct(s: SpeechStats | null | undefined): number | null {
  if (!s || s.words < MIN_WORDS_FOR_CLARITY) return null;
  return Math.round((100 * s.clear) / s.words);
}
