const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A tiny silent MP3, played on the first tap to unlock audio on iOS.
const SILENCE =
  'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

export const readingTimeMs = (text: string) =>
  Math.min(8000, 800 + text.split(/\s+/).length * 300);

interface Item {
  text: string;
  /** undefined: still coming. null: no voice for this sentence. */
  audio: Blob | null | undefined;
}

/**
 * Plays one patient reply that arrives in pieces. Sentences are queued as
 * they stream in and each plays as soon as its audio is there, so the patient
 * starts talking on the first sentence.
 */
export class ReplyPlayer {
  private items: Item[] = [];
  private closed = false;
  private wake: (() => void) | null = null;
  firstSoundAt: number | null = null;

  constructor(
    private readonly renderer: VoiceRenderer,
    private readonly onSentence: (text: string, index: number) => void,
  ) {}

  private poke() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  say(seq: number, text: string) {
    this.items[seq] = { text, audio: this.items[seq]?.audio };
    this.poke();
  }

  audio(seq: number, blob: Blob) {
    const it = this.items[seq];
    this.items[seq] = { text: it?.text ?? '', audio: blob };
    this.poke();
  }

  /** No more pieces are coming. Sentences still without voice are shown as text. */
  finish() {
    this.closed = true;
    for (const it of this.items) if (it && it.audio === undefined) it.audio = null;
    this.poke();
  }

  get received() {
    return this.items.filter(Boolean).length;
  }

  /** Plays everything, in order, until finish() and the queue is empty. */
  async run(pauseBeforeMs: number): Promise<void> {
    if (pauseBeforeMs > 0) await sleep(pauseBeforeMs);
    for (let i = 0; ; i++) {
      while (!this.renderer.stopped) {
        const it = this.items[i];
        if (it && it.text && it.audio !== undefined) break;
        if (this.closed && i >= this.items.length) return;
        await new Promise<void>((r) => (this.wake = r));
      }
      if (this.renderer.stopped) return;
      const it = this.items[i]!;
      this.firstSoundAt ??= performance.now();
      this.onSentence(it.text, i);
      await this.renderer.play(it.audio ?? null, it.text);
    }
  }
}

/**
 * v1 patient renderer: voice plus an illustrated portrait. Nonverbal cues are
 * shown as small captions above the patient's words, since there is no video yet.
 */
export class VoiceRenderer {
  private audio = new Audio();
  stopped = false;
  private currentUrl: string | null = null;

  constructor() {
    this.audio.preload = 'auto';
  }

  async mount(): Promise<void> {
    // Must be called from a user tap (iOS audio unlock).
    this.audio.src = SILENCE;
    await this.audio.play().catch(() => undefined);
  }

  /** Plays one clip, or waits long enough to read `text` if there's no audio. */
  async play(blob: Blob | null, text: string): Promise<void> {
    if (this.stopped) return;
    if (!blob || !blob.size) return void (await sleep(readingTimeMs(text)));
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = URL.createObjectURL(blob);
    this.audio.src = this.currentUrl;
    try {
      await this.audio.play();
      await new Promise<void>((resolve) => {
        this.audio.onended = () => resolve();
        this.audio.onerror = () => resolve();
        this.audio.onpause = () => resolve();
      });
    } catch {
      await sleep(readingTimeMs(text));
    }
  }

  dispose(): void {
    this.stopped = true;
    this.audio.pause();
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
  }
}

export const NONVERBAL_TEXT: Record<string, string> = {
  look_away: 'looks away',
  frown: 'frowns',
  nod: 'nods',
  fidget: 'fidgets',
  avoid_eye_contact: 'avoids eye contact',
  smile: 'smiles',
};

/** "(frowns, looks away)" style caption text, without the parentheses. */
export const nonverbalLine = (cues: string[] | undefined) =>
  cues?.length ? cues.map((n) => NONVERBAL_TEXT[n] ?? n.replace(/_/g, ' ')).join(', ') : '';
