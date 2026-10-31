import {
  characterSlug,
  MOODS,
  stepToward,
  type Mood,
  type NonverbalCue,
} from '@plainspeak/shared';
import { GRID, HeadMatcher } from './headMatch';
import { cueForWords, type CueRules } from './cueWords';

export type { Mood };

export interface ClipManifest {
  start: Mood;
  moods: Partial<Record<Mood, { poster: string; clips: Partial<Record<NonverbalCue, string>> }>>;
  transitions?: Partial<Record<`${Mood}>${Mood}`, string>>;
  /** Their own word patterns for each mood, checked before the general ones. */
  cueWords?: Partial<Record<Mood, CueRules>>;
}

/** Folder name for a patient's clips: "Ray Kowalski" → "ray-kowalski". */
export const patientSlug = characterSlug;

/** At most one body-language clip this often (so it never looks like a loop). */
export const CLIP_GAP_MS = 6000;
/** Ray may start talking this long before a clip ends (it fades into his live face). */
const NEAR_END_MS = 400;
/** How long a clip takes to fade in or out (matches .stage-clip in styles.css). */
const FADE_MS = 400;
/** A clip's first frame normally draws within a frame or two; never wait longer than this. */
const FIRST_FRAME_WAIT_MS = 250;
/** A mood change waits for the next face to connect, or this long regardless. */
const PREPARE_WAIT_MS = 8000;
/** Mood changes at most this often, so the face doesn't flicker between moods. */
export const MOOD_GAP_MS = 15000;
/** A clip waits at most this long for his live head to be still and near its resting spot. */
const STILL_WAIT_MS = 1500;
/** "Near its resting spot" and "still", in head-match grid pixels (about 1% and 0.4%). */
const NEAR_PX = 0.45;
const STEADY_PX = 0.3;
/** "Close to resting size" and "not still changing size" (head size; 1 = resting). */
const NEAR_SCALE = 0.005;
const STEADY_SCALE = 0.003;
/**
 * Below this (in % of the picture) the clip isn't moved to meet his head:
 * moving it slides the wall behind him too, which shows more than a
 * sub-pixel difference in his head does.
 */
const MIN_SHIFT_PCT = 0.6;
/** Likewise for head size: below this the clip isn't zoomed to match (0.6%). */
const MIN_ZOOM = 0.006;

/**
 * The patient's body language (test): short clips of the same face, played
 * over the live video face while he isn't talking. Each clip starts and ends
 * on his resting face, so it fades cleanly back to the live face. His mood
 * moves along the ladder (upset, guarded, at ease, happy) one step at a time,
 * through a transition clip, then his live face for the new mood.
 */
/** How often clips played this session, and why others didn't (saved with the session). */
export interface BodyStats {
  /** Clips that played, by cue (and "from>to" for each mood change). */
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
  private holding = false;
  /** The mood the director wants; he moves toward it one step at a time. */
  private target: Mood | null = null;
  /** The next step, being connected (his live face for it). */
  private next: Mood | null = null;
  private lastMoodAt = -Infinity;
  private stepTimer: ReturnType<typeof setTimeout> | undefined;
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
  /** His face for the next mood has connected (or we stopped waiting for it). */
  private prepared = false;
  private heads = new HeadMatcher();

  constructor(
    private readonly manifest: ClipManifest,
    private readonly base: string,
    private readonly el: HTMLVideoElement,
    /** The live video face, to line clips up with where his head is. */
    private readonly live: () => HTMLVideoElement | null = () => null,
    /** Face check: clips can follow each other sooner. */
    private readonly gapMs = CLIP_GAP_MS,
    /** Face check: moods can change sooner. */
    private readonly moodGapMs = MOOD_GAP_MS,
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
   * but the live face sways a little. If his head is noticeably off, the clip
   * is moved to where it is for the whole clip (no double image while both
   * show, and the wall behind him never slides).
   */
  private show(on: boolean, rest: string | null = this.poster) {
    const el = this.el;
    const o = this.heads.offset(this.live(), rest);
    this.onEvent?.({
      type: on ? 'fade-in' : 'fade-out',
      src: el.src.slice(-40),
      // Where his live head was, in % of the picture (the clip moves there).
      headX: o ? +(o.x * 100).toFixed(2) : null,
      headY: o ? +(o.y * 100).toFixed(2) : null,
      headScale: o ? +o.scale.toFixed(3) : null,
    });
    // Fading out, the clip stays where it is: moving it would slide the wall.
    if (!on) {
      el.style.transition = '';
      el.classList.remove('on');
      return;
    }
    // Fading in: if his live head is noticeably off his resting spot, the clip
    // starts there and stays there (no glide back, which also slid the wall).
    // A mood change shows the whole room, so moving it would move the wall: never.
    const at =
      !el.classList.contains('whole') &&
      o && (Math.hypot(o.x, o.y) * 100 > MIN_SHIFT_PCT || Math.abs(o.scale - 1) > MIN_ZOOM)
        ? `translate(${(o.x * 100).toFixed(2)}%, ${(o.y * 100).toFixed(2)}%) scale(${o.scale.toFixed(4)})`
        : '';
    el.style.transition = 'none';
    el.style.transform = at;
    void el.offsetWidth; // apply that position before fading in
    el.style.transition = '';
    el.classList.add('on');
  }

  /**
   * `whole`: a mood change. It plays full-frame, since it blends one live
   * face's room into the other's; expression clips show only the patient.
   */
  private start(file: string, whole = false): Promise<number> | null {
    const url = this.urls.get(file);
    if (!url) return null;
    const el = this.el;
    el.classList.toggle('whole', whole);
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
      this.tryStep();
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
    let prev: { x: number; y: number; scale: number } | null = null;
    while (performance.now() < until) {
      const o = this.heads.offset(this.live(), this.poster);
      if (!o) return; // can't tell: don't hold the clip up
      const near = Math.hypot(o.x, o.y) * GRID <= NEAR_PX && Math.abs(o.scale - 1) <= NEAR_SCALE;
      const steady =
        !!prev &&
        Math.hypot(o.x - prev.x, o.y - prev.y) * GRID <= STEADY_PX &&
        Math.abs(o.scale - prev.scale) <= STEADY_SCALE;
      if (near && steady) return;
      prev = o;
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  /** The body language that fits what he just said, in his current mood (or none). */
  cueFor(text: string): NonverbalCue | null {
    return cueForWords(text, this.mood, this.manifest.cueWords?.[this.mood]);
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
    if (!on) this.tryStep();
  }

  /** The resident earned their trust: at least at ease. */
  relax() {
    if (MOODS.indexOf(this.mood) < MOODS.indexOf('at_ease')) this.moveTo('at_ease');
  }

  /**
   * Their mood should now be `m` (the director's call). They move toward it one
   * step at a time, at most every MOOD_GAP_MS. For each step the next face
   * connects first, in the background; then, as soon as they're quiet, the
   * transition clip plays and the faces swap at its last frame.
   */
  moveTo(m: Mood) {
    this.target = m;
    this.planStep();
  }

  private planStep() {
    if (this.next || !this.target || this.target === this.mood) return;
    const n = stepToward(this.mood, this.target);
    // No face for that mood (e.g. Ray has no upset face): stay where they are.
    if (!this.manifest.moods[n]) {
      this.target = null;
      return;
    }
    const wait = this.lastMoodAt + this.moodGapMs - performance.now();
    if (wait > 0) {
      clearTimeout(this.stepTimer);
      this.stepTimer = setTimeout(() => this.planStep(), wait);
      return;
    }
    this.next = n;
    this.prepared = false;
    const ready = this.onPrepare ? this.onPrepare(n).catch(() => false) : null;
    const done = () => {
      if (this.next !== n) return;
      this.prepared = true;
      this.tryStep();
    };
    if (!ready) return done();
    void Promise.race([ready, new Promise((r) => setTimeout(r, PREPARE_WAIT_MS))]).then(done);
  }

  private tryStep() {
    if (!this.next || !this.prepared || this.speaking || this.playing) return;
    // The director changed their mind while the face connected: start over.
    if (!this.target || stepToward(this.mood, this.target) !== this.next) {
      this.next = null;
      return this.planStep();
    }
    this.stepNow();
  }

  private stepNow() {
    const from = this.mood;
    const to = this.next!;
    this.next = null;
    const file = this.manifest.transitions?.[`${from}>${to}`];
    // Starts from their old face, so line it up with that; then the new mood.
    const started = file ? this.start(file, true) : null;
    this.mood = to;
    this.lastMoodAt = performance.now();
    if (MOODS.indexOf(to) >= MOODS.indexOf('at_ease')) this.stats.relaxed = true;
    const key = `${from}>${to}`;
    this.stats.shown[key] = (this.stats.shown[key] ?? 0) + 1;
    this.onEvent?.({ type: 'mood', from, to, clip: !!started });
    if (!started) {
      this.holding = true;
      this.faceReady = false;
      return this.onMood?.(to);
    }
    this.playing = 'transition';
    // At its last frame (the new mood's face), the live face switches underneath.
    this.el.onended = () => this.endTransition();
  }

  private endTransition() {
    if (this.playing !== 'transition') return;
    this.playing = null;
    this.holding = true;
    this.faceReady = false;
    this.onMood?.(this.mood);
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
    // Further along the ladder still to go?
    this.planStep();
  }

  dispose() {
    clearTimeout(this.stepTimer);
    this.el.pause();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}
