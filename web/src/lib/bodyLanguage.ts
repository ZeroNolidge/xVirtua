import type { NonverbalCue } from '@plainspeak/shared';
import { GRID, HeadMatcher } from './headMatch';

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
/** How long a clip takes to fade in or out (matches .stage-clip in styles.css). */
const FADE_MS = 400;
/** A clip's first frame normally draws within a frame or two; never wait longer than this. */
const FIRST_FRAME_WAIT_MS = 250;
/** He relaxes once his relaxed face is ready, or after this long regardless. */
const PREPARE_WAIT_MS = 8000;
/** A clip waits at most this long for his live head to be still and near its resting spot. */
const STILL_WAIT_MS = 800;
/** "Near its resting spot" and "still", in head-match grid pixels (about 1% and 0.4%). */
const NEAR_PX = 0.45;
const STEADY_PX = 0.3;
/**
 * Below this (in % of the picture) the clip isn't moved to meet his head:
 * moving it slides the wall behind him too, which shows more than a
 * sub-pixel difference in his head does.
 */
const MIN_SHIFT_PCT = 0.6;
/** After fading in, the clip glides from the live head's position to its own, this slowly. */
const SETTLE_MS = 700;

/**
 * The patient's body language (test): short clips of the same face, played
 * over the live video face while he isn't talking. Each clip starts and ends
 * on his resting face, so it fades cleanly back to the live face. He starts
 * guarded and can relax once (a transition clip, then the at-ease face).
 */
/** How often clips played this session, and why others didn't (saved with the session). */
export interface BodyStats {
  /** Clips that played, by cue (and "relax" for the mood change). */
  shown: Record<string, number>;
  /** Times a clip was asked for but didn't play, by reason. */
  skipped: Record<string, number>;
  /** Total time clips waited for his head to be still. */
  stillWaitMs: number;
  relaxed: boolean;
}

export class BodyLanguage {
  mood: Mood;
  readonly stats: BodyStats = { shown: {}, skipped: {}, stillWaitMs: 0, relaxed: false };
  /** Counts a clip that didn't play, and why. */
  skip(reason: string) {
    this.stats.skipped[reason] = (this.stats.skipped[reason] ?? 0) + 1;
    this.onEvent?.({ type: 'skipped', reason });
  }
  /** Face check: a timing note for each fade (where his live head was, and so on). */
  onEvent: ((e: Record<string, unknown>) => void) | null = null;
  private urls = new Map<string, string>();
  private playing: 'cue' | 'transition' | null = null;
  private lastAt = -Infinity;
  private speaking = false;
  private relaxPending = false;
  private holding = false;
  /**
   * Connects his live face for a mood in the background (the current one
   * keeps going), so the switch later has no gap. Resolves when it's ready.
   */
  onPrepare: ((m: Mood) => Promise<boolean>) | null = null;
  /**
   * The mood changed: the live face should switch to match now (call reveal()
   * once it has). The transition clip holds on its last frame until then.
   */
  onMood: ((m: Mood) => void) | null = null;
  /** His relaxed face has connected (or we stopped waiting for it). */
  private prepared = false;
  private heads = new HeadMatcher();
  private settle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly manifest: ClipManifest,
    private readonly base: string,
    private readonly el: HTMLVideoElement,
    /** The live video face, to line clips up with where his head is. */
    private readonly live: () => HTMLVideoElement | null = () => null,
    /** Face check: clips can follow each other sooner. */
    private readonly gapMs = CLIP_GAP_MS,
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
    const posters = Object.values(this.manifest.moods).flatMap((m) =>
      m?.poster ? [`${this.base}/${m.poster}`] : [],
    );
    await Promise.all([
      ...posters.map((u) => this.heads.addReference(u).catch(() => undefined)),
      ...[...files].map(async (f) => {
        const r = await fetchFn(`${this.base}/${f}`);
        if (r.ok) this.urls.set(f, URL.createObjectURL(await r.blob()));
      }),
    ]);
  }

  /** His resting face for the current mood (shown under the live face). */
  get poster(): string | null {
    const p = this.manifest.moods[this.mood]?.poster;
    return p ? `${this.base}/${p}` : null;
  }

  /**
   * Fades the clip in or out. Every clip starts and ends on his resting face,
   * but the live face sways a little, so the clip is first moved to where the
   * live head is (no double image while both show), then glides back.
   */
  private show(on: boolean, rest: string | null = this.poster) {
    const el = this.el;
    clearTimeout(this.settle);
    const o = this.heads.offset(this.live(), rest);
    this.onEvent?.({
      type: on ? 'fade-in' : 'fade-out',
      src: el.src.slice(-40),
      // Where his live head was, in % of the picture (the clip moves there).
      headX: o ? +(o.x * 100).toFixed(2) : null,
      headY: o ? +(o.y * 100).toFixed(2) : null,
    });
    const at =
      o && Math.hypot(o.x, o.y) * 100 > MIN_SHIFT_PCT
        ? `translate(${(o.x * 100).toFixed(2)}%, ${(o.y * 100).toFixed(2)}%)`
        : '';
    if (on) {
      el.style.transition = 'none';
      el.style.transform = at;
      void el.offsetWidth; // apply that position before fading in
      el.style.transition = '';
      el.classList.add('on');
      if (at)
        this.settle = setTimeout(() => {
          el.style.transition = `opacity ${FADE_MS}ms ease, transform ${SETTLE_MS}ms ease-in-out`;
          el.style.transform = '';
        }, FADE_MS);
    } else {
      el.style.transition = `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease-out`;
      el.style.transform = at;
      el.classList.remove('on');
    }
  }

  private start(file: string): Promise<number> | null {
    const url = this.urls.get(file);
    if (!url) return null;
    const el = this.el;
    const rest = this.poster; // the clip's first frame (his mood may change meanwhile)
    el.src = url;
    el.currentTime = 0;
    // Fade in only once its first frame is on screen (else it pops in mid-fade).
    const drawn = new Promise<void>((done) => {
      const v = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => done());
      else el.addEventListener('playing', () => done(), { once: true });
      setTimeout(done, FIRST_FRAME_WAIT_MS);
    });
    return el.play().then(
      async () => {
        const asked = performance.now();
        await drawn;
        this.onEvent?.({ type: 'first-frame', ms: Math.round(performance.now() - asked) });
        // Still wanted (he may have started talking meanwhile).
        if (this.playing && el.src === url) this.show(true, rest);
        return Number.isFinite(el.duration) ? el.duration * 1000 : 4000;
      },
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
    const why = !cues.length
      ? 'no cue'
      : !cue
        ? `no ${this.mood} clip`
        : this.playing
          ? 'clip already playing'
          : this.speaking
            ? 'he was talking'
            : now - this.lastAt < this.gapMs
              ? 'too soon after the last'
              : null;
    if (why || !cue) {
      this.skip(why ?? 'no cue');
      return false;
    }
    this.playing = 'cue';
    this.lastAt = now;
    await this.stillMoment();
    this.stats.stillWaitMs += Math.round(performance.now() - now);
    this.onEvent?.({ type: 'still-wait', cue, ms: Math.round(performance.now() - now) });
    // He started talking (or something else took over) while we waited.
    if (this.playing !== 'cue' || this.speaking) {
      if (this.playing === 'cue') this.playing = null;
      this.skip('he talked while it waited');
      return false;
    }
    const started = this.start(clips[cue]!);
    if (!started) {
      this.playing = null;
      this.skip('clip missing');
      return false;
    }
    this.el.onended = () => {
      if (this.playing !== 'cue') return;
      this.playing = null;
      this.show(false);
      this.tryRelax();
    };
    const ms = await started;
    if (!ms) {
      this.playing = null;
      this.skip('clip would not play');
      return false;
    }
    this.stats.shown[cue] = (this.stats.shown[cue] ?? 0) + 1;
    // The wait for a still moment counts towards maxWaitMs.
    const left = Math.max(0, maxWaitMs - (performance.now() - now));
    await new Promise((r) => setTimeout(r, Math.min(left, Math.max(0, ms - NEAR_END_MS))));
    return true;
  }

  /**
   * Waits (briefly) until his live head is still and close to where it is in
   * the clip's first frame, so the switch to the clip is hard to see.
   */
  private async stillMoment() {
    const until = performance.now() + STILL_WAIT_MS;
    let prev: { x: number; y: number } | null = null;
    while (performance.now() < until) {
      const o = this.heads.offset(this.live(), this.poster);
      if (!o) return; // can't tell: don't hold the clip up
      const near = Math.hypot(o.x, o.y) * GRID <= NEAR_PX;
      const steady = !!prev && Math.hypot(o.x - prev.x, o.y - prev.y) * GRID <= STEADY_PX;
      if (near && steady) return;
      prev = o;
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  /** He started or stopped talking: a cue clip gives way to his live face. */
  setSpeaking(on: boolean) {
    this.speaking = on;
    if (on && this.playing === 'cue') {
      this.playing = null;
      this.show(false);
    }
    // Talking during the mood change: switch faces now, so his mouth moves.
    if (on && this.playing === 'transition') {
      this.el.pause();
      this.endTransition();
    }
    if (!on) this.tryRelax();
  }

  /**
   * The resident earned his trust: he relaxes (once). His relaxed face
   * connects first, in the background; then, as soon as he's quiet, the
   * transition clip plays and the faces swap at its last frame.
   */
  relax() {
    if (this.mood !== 'guarded' || !this.manifest.moods.at_ease || this.relaxPending) return;
    this.relaxPending = true;
    this.prepared = false;
    const ready = this.onPrepare ? this.onPrepare('at_ease').catch(() => false) : null;
    const done = () => {
      this.prepared = true;
      this.tryRelax();
    };
    if (!ready) return done();
    void Promise.race([ready, new Promise((r) => setTimeout(r, PREPARE_WAIT_MS))]).then(done);
  }

  private tryRelax() {
    if (this.relaxPending && this.prepared && !this.speaking && !this.playing) this.relaxNow();
  }

  private relaxNow() {
    this.relaxPending = false;
    if (this.mood !== 'guarded') return;
    const file = this.manifest.transitions?.['guarded>at_ease'];
    // Starts from his guarded face, so line it up with that; then he's at ease.
    const started = file ? this.start(file) : null;
    this.mood = 'at_ease';
    this.stats.relaxed = true;
    if (started) this.stats.shown.relax = (this.stats.shown.relax ?? 0) + 1;
    if (!started) return this.onMood?.('at_ease');
    this.playing = 'transition';
    // At its last frame (his at-ease face), the live face switches underneath.
    this.el.onended = () => this.endTransition();
  }

  private endTransition() {
    if (this.playing !== 'transition') return;
    this.playing = null;
    this.holding = true;
    this.faceReady = false;
    this.onMood?.('at_ease');
  }

  private faceReady = false;

  /** The live face for the new mood is up: the transition clip gives way to it. */
  reveal() {
    this.faceReady = true;
    if (this.holding && this.playing !== 'transition') this.release();
  }

  private release() {
    this.holding = false;
    this.show(false);
  }

  dispose() {
    clearTimeout(this.settle);
    this.el.pause();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}
