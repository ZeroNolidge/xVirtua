/**
 * What the patient "brain" returns each turn. Produced by Claude as structured
 * output on the server, validated, then handed to a PatientRenderer.
 */
export const EMOTIONS = [
  'neutral',
  'worried',
  'sad',
  'hesitant',
  'frustrated',
  'relieved',
  'confused',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const NONVERBAL_CUES = [
  'look_away',
  'frown',
  'nod',
  'fidget',
  'avoid_eye_contact',
  'smile',
] as const;
export type NonverbalCue = (typeof NONVERBAL_CUES)[number];

export interface Delivery {
  emotion: Emotion;
  volume: 'quiet' | 'normal';
  rate: 'slow' | 'normal';
  /** Silence before the patient speaks. Enforced by our player, so it works with any vendor. */
  pauseBeforeMs: number;
}

export interface PatientUtterance {
  text: string;
  /** True when the patient asked the resident a question (used for steamrolling detection). */
  askedQuestion: boolean;
  /** The scripted cue being performed this turn, if any. */
  cueId?: string;
  delivery: Delivery;
  nonverbal: NonverbalCue[];
}

/**
 * Pieces of a patient reply streamed to the app while Claude is still
 * writing, so the voice can start on the first sentence.
 */
export type PatientChunk =
  | { t: 'meta'; delivery: Delivery; nonverbal: NonverbalCue[] }
  | { t: 'say'; seq: number; text: string }
  | { t: 'audio'; seq: number; b64: string; mime: string };

export interface RendererCapabilities {
  video: boolean;
  /** Nonverbal cues this renderer can actually show. Others fall back to captions. */
  nonverbal: NonverbalCue[];
}

/**
 * Swappable patient presentation. v1 ships a voice-only renderer; video
 * providers plug in behind the same interface later.
 */
export interface PatientRenderer {
  mount(el: HTMLElement): Promise<void>;
  /** `audio` is our TTS stream; null when the renderer voices the text itself. */
  speak(utterance: PatientUtterance, audio: ReadableStream<Uint8Array> | null): Promise<void>;
  setListening(listening: boolean): void;
  /** Resident talked over the patient. */
  interrupt(): void;
  capabilities(): RendererCapabilities;
  dispose(): void;
}
