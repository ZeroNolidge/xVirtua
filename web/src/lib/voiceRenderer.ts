const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A tiny silent MP3, played on the first tap to unlock audio on iOS.
const SILENCE =
  'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

export const readingTimeMs = (text: string) => Math.min(8000, 800 + text.split(/\s+/).length * 300);

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
  /** Sentences the resident actually heard (started playing). */
  readonly played: string[] = [];
  /** Fetches a sentence's voice that didn't arrive with the reply. */
  fillVoice: ((text: string) => Promise<Blob | null>) | null = null;
  /** Sentences that played as text only (their voice never arrived). */
  readonly noVoice: string[] = [];
  /** The resident talked over the patient; playback stopped. */
  interrupted = false;

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

  /** Stops mid-sentence: the resident is talking over the patient. */
  interrupt() {
    if (this.interrupted) return;
    this.interrupted = true;
    this.closed = true;
    this.renderer.stopClip();
    this.poke();
  }

  /** Everything the patient has said so far, for telling echo from the resident. */
  get spokenSoFar() {
    return this.played.join(' ');
  }

  get received() {
    return this.items.filter(Boolean).length;
  }

  /** Plays everything, in order, until finish() and the queue is empty. */
  async run(pauseBeforeMs: number): Promise<void> {
    // The patient's deliberate pause; the resident may start talking during it.
    for (let left = pauseBeforeMs; left > 0 && !this.interrupted; left -= 100)
      await sleep(Math.min(100, left));
    for (let i = 0; ; i++) {
      while (!this.renderer.stopped && !this.interrupted) {
        const it = this.items[i];
        if (it && it.text && it.audio !== undefined) break;
        if (this.closed && i >= this.items.length) return;
        await new Promise<void>((r) => (this.wake = r));
      }
      if (this.renderer.stopped || this.interrupted) return;
      const it = this.items[i]!;
      // Its voice never came with the reply: fetch it now rather than skip it.
      if (it.audio === null && this.fillVoice) {
        const fill = this.fillVoice;
        it.audio = await Promise.race([
          fill(it.text).catch(() => null),
          sleep(5000).then(() => null),
        ]);
        if (this.renderer.stopped || this.interrupted) return;
      }
      this.firstSoundAt ??= performance.now();
      this.played.push(it.text);
      this.onSentence(it.text, i);
      if (!it.audio) this.noVoice.push(it.text);
      await this.renderer.play(it.audio ?? null, it.text);
      if (this.interrupted) return;
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
  private textWait: (() => void) | null = null;

  /** Waits long enough to read `text`, unless stopped. */
  private readingPause(text: string) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, readingTimeMs(text));
      const self = this;
      function done() {
        clearTimeout(t);
        if (self.textWait === done) self.textWait = null;
        resolve();
      }
      this.textWait = done;
    });
  }

  /** The player itself (the video avatar listens to it). */
  get element(): HTMLAudioElement {
    return this.audio;
  }

  /** How far through the current clip we are, 0–1 (1 when there's no clip). */
  get progress(): number {
    if (!this.clipPlaying) return 1;
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? Math.min(1, this.audio.currentTime / d) : 0;
  }
  private clipPlaying = false;

  async play(blob: Blob | null, text: string): Promise<void> {
    if (this.stopped) return;
    this.audio.volume = 1;
    this.clipPlaying = false;
    if (!blob || !blob.size) return this.readingPause(text);
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = URL.createObjectURL(blob);
    this.audio.src = this.currentUrl;
    try {
      this.clipPlaying = true;
      await this.audio.play();
      await new Promise<void>((resolve) => {
        this.audio.onended = () => resolve();
        this.audio.onerror = () => resolve();
        this.audio.onpause = () => resolve();
      });
    } catch {
      this.clipPlaying = false;
      await this.readingPause(text);
    }
    this.clipPlaying = false;
  }

  /** The video avatar, when it plays the voice instead (it follows duck and stop). */
  follower: { duck(on: boolean): void; clear(): void } | null = null;

  /** Turn the patient down while we check whether the resident is starting to talk. */
  duck(on: boolean) {
    this.audio.volume = on ? 0.05 : 1;
    this.follower?.duck(on);
  }

  /** Stops the clip that's playing (play() then returns). */
  stopClip() {
    this.audio.pause();
    this.follower?.clear();
    const w = this.textWait;
    this.textWait = null;
    w?.();
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
