/**
 * One patient reply in GPT-Live mode, as it was actually said out loud.
 * GPT-Live sends its transcript of the patient's speech in pieces, each with
 * a start time on the call's clock. The transcript can run ahead of the
 * audio, so on a cut-off we keep only the words that had started playing.
 */
export interface SpokenPiece {
  text: string;
  /** Start of this piece on GPT-Live's clock (ms), if given. */
  startMs?: number;
}

export class LiveReply {
  /** The saved patient turn, once the server has answered. */
  idx: number | null;
  readonly pieces: SpokenPiece[] = [];
  /** performance.now() when the patient became audible for this reply. */
  firstAudibleAt: number | null = null;
  lastPieceAt = 0;
  /** What the patient got out before the resident cut in. */
  cut: string | null = null;
  /** How much audio had played when cut off (ms). */
  cutAtMs: number | null = null;
  /** The spoken text (or cut-off) has been saved on the server. */
  saved = false;
  /** Resident words that arrived late but belong to the turn before this reply. */
  late = '';
  lateSaved = false;
  readonly takenAt: number;
  /** Claude's line, sent to GPT-Live (shown only if GPT-Live sends no transcript). */
  planned = '';
  nonverbal: string[] = [];
  /** performance.now() when the line went to GPT-Live. */
  sentAt: number | null = null;
  /** What the bubble shows now. */
  shown = '';
  /** GPT-Live answered on its own (it never asked us for this line). */
  selfReply = false;
  /** For a self-reply: what the resident had said. */
  residentText = '';
  /** For a self-reply: it's a real answer (not just "mm-hm"), so it counts as a turn. */
  committed = false;
  /** Bubble key, for a reply not saved on the server yet. */
  key: string | null = null;
  /** GPT-Live has finished this reply (or it was cut off). */
  get finished() {
    return this.saved || this.cut !== null;
  }

  constructor(
    idx: number | null,
    /** The resident bubble this reply answers, for late words. */
    readonly residentKey: string | null,
    now = performance.now(),
  ) {
    this.idx = idx;
    this.takenAt = now;
  }

  add(text: string, startMs?: number, now = performance.now()) {
    this.pieces.push({ text, ...(startMs !== undefined ? { startMs } : {}) });
    this.lastPieceAt = now;
  }

  /** Everything GPT-Live has said for this reply so far. */
  get spoken(): string {
    return tidy(this.pieces.map((p) => p.text).join(''));
  }

  /** The words that had started playing `playedMs` into the reply. */
  heardBy(playedMs: number): string {
    const t0 = this.pieces.find((p) => p.startMs !== undefined)?.startMs;
    if (t0 === undefined) return this.spoken;
    return tidy(
      this.pieces
        .filter((p) => p.startMs === undefined || p.startMs - t0 <= playedMs)
        .map((p) => p.text)
        .join(''),
    );
  }

  /** What the resident has heard so far, as the patient speaks. */
  heardSoFar(now = performance.now()): string {
    if (this.cut !== null) return this.cut;
    if (this.firstAudibleAt === null) return '';
    return this.heardBy(now - this.firstAudibleAt);
  }

  /** Cuts the reply off now; returns what was heard. */
  cutOff(now = performance.now()): string {
    if (this.cut !== null) return this.cut;
    const played = this.firstAudibleAt === null ? 0 : Math.max(0, now - this.firstAudibleAt);
    this.cutAtMs = Math.round(played);
    this.cut = this.firstAudibleAt === null ? '' : this.heardBy(played);
    return this.cut;
  }
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Ray is talking, or stopped less than this long ago: mic input may be his own echo. */
export const ECHO_WINDOW_MS = 1500;
/** The resident's mic was loud this recently: words in the echo window can be theirs. */
export const MIC_EVIDENCE_MS = 2000;

const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** Every word of this piece is one the patient just said: it's his voice in the mic. */
export function isEcho(piece: string, patientSaid: string): boolean {
  const w = words(piece);
  if (!w.length) return false;
  const his = new Set(words(patientSaid));
  return w.every((x) => his.has(x));
}
