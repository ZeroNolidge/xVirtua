import type { NonverbalCue } from '@plainspeak/shared';

export type Mood = 'guarded' | 'at_ease';

export interface ClipManifest {
  start: Mood;
  moods: Partial<Record<Mood, { poster: string; clips: Partial<Record<NonverbalCue, string>> }>>;
  transitions?: Partial<Record<`${Mood}>${Mood}`, string>>;
}

/** Folder name for a patient's clips: "Ray Kowalski" → "ray-kowalski". */
export const patientSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** At most one body-language clip this often (so it never looks like a loop). */
export const CLIP_GAP_MS = 6000;
/** Ray may start talking this long before a clip ends (it fades into his live face). */
const NEAR_END_MS = 400;

/**
 * The patient's body language (test): short clips of the same face, played
 * over the live video face while he isn't talking. Each clip starts and ends
 * on his resting face, so it fades cleanly back to the live face. He starts
 * guarded and can relax once (a transition clip, then the at-ease face).
 */
export class BodyLanguage {
  mood: Mood;
  private urls = new Map<string, string>();
  private playing: 'cue' | 'transition' | null = null;
  private lastAt = -Infinity;
  private speaking = false;
  private relaxPending = false;
  private holding = false;
  /** The mood changed (the live face should switch to match). */
  onMood: ((m: Mood) => void) | null = null;

  constructor(
    private readonly manifest: ClipManifest,
    private readonly base: string,
    private readonly el: HTMLVideoElement,
  ) {
    this.mood = manifest.start;
    el.muted = true;
    el.playsInline = true;
  }

  /** Downloads every clip up front, so each one starts instantly. */
  async load(fetchFn: typeof fetch = fetch) {
    const files = new Set<string>();
    for (const m of Object.values(this.manifest.moods)) {
      if (!m) continue;
      for (const f of Object.values(m.clips)) if (f) files.add(f);
    }
    for (const f of Object.values(this.manifest.transitions ?? {})) if (f) files.add(f);
    await Promise.all(
      [...files].map(async (f) => {
        const r = await fetchFn(`${this.base}/${f}`);
        if (r.ok) this.urls.set(f, URL.createObjectURL(await r.blob()));
      }),
    );
  }

  /** His resting face for the current mood (shown under the live face). */
  get poster(): string | null {
    const p = this.manifest.moods[this.mood]?.poster;
    return p ? `${this.base}/${p}` : null;
  }

  private show(on: boolean) {
    this.el.classList.toggle('on', on);
  }

  private start(file: string): Promise<number> | null {
    const url = this.urls.get(file);
    if (!url) return null;
    this.el.src = url;
    this.el.currentTime = 0;
    this.show(true);
    return this.el.play().then(
      () => (Number.isFinite(this.el.duration) ? this.el.duration * 1000 : 4000),
      () => {
        this.show(false);
        return 0;
      },
    );
  }

  /**
   * Plays the first of these cues that has a clip for his mood. Resolves when
   * it's nearly over (so his next words can start), at most `maxWaitMs`; at
   * once if nothing plays.
   */
  async cue(cues: readonly NonverbalCue[], maxWaitMs = 0): Promise<boolean> {
    const clips = this.manifest.moods[this.mood]?.clips ?? {};
    const cue = cues.find((c) => clips[c]);
    const now = performance.now();
    if (!cue || this.playing || this.speaking || now - this.lastAt < CLIP_GAP_MS) return false;
    const started = this.start(clips[cue]!);
    if (!started) return false;
    this.playing = 'cue';
    this.lastAt = now;
    this.el.onended = () => {
      if (this.playing !== 'cue') return;
      this.playing = null;
      this.show(false);
    };
    const ms = await started;
    if (!ms) {
      this.playing = null;
      return false;
    }
    await new Promise((r) => setTimeout(r, Math.min(maxWaitMs, Math.max(0, ms - NEAR_END_MS))));
    return true;
  }

  /** He started or stopped talking: a cue clip gives way to his live face. */
  setSpeaking(on: boolean) {
    this.speaking = on;
    if (on && this.playing === 'cue') {
      this.playing = null;
      this.show(false);
    }
    if (!on && this.relaxPending) this.relaxNow();
  }

  /** The resident earned his trust: he relaxes as soon as he's quiet (once). */
  relax() {
    if (this.mood !== 'guarded' || !this.manifest.moods.at_ease) return;
    this.relaxPending = true;
    if (!this.speaking && !this.playing) this.relaxNow();
  }

  private relaxNow() {
    this.relaxPending = false;
    if (this.mood !== 'guarded') return;
    const file = this.manifest.transitions?.['guarded>at_ease'];
    this.mood = 'at_ease';
    const started = file ? this.start(file) : null;
    if (started) {
      this.playing = 'transition';
      // Holds on its last frame (his at-ease face) until the live face catches up.
      this.holding = true;
      this.faceReady = false;
      this.el.onended = () => {
        if (this.playing === 'transition') this.playing = null;
        if (this.faceReady) this.release();
      };
    }
    this.onMood?.('at_ease');
  }

  private faceReady = false;

  /** The live face for the new mood is up: show it once the transition has played out. */
  reveal() {
    this.faceReady = true;
    if (this.holding && this.playing !== 'transition') this.release();
  }

  private release() {
    this.holding = false;
    this.show(false);
  }

  dispose() {
    this.el.pause();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}
