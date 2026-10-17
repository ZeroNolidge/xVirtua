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
