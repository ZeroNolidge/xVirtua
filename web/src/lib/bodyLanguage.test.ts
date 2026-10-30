import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BodyLanguage, patientSlug, type ClipManifest } from './bodyLanguage';

const manifest: ClipManifest = {
  start: 'guarded',
  moods: {
    guarded: { poster: 'guarded.jpg', clips: { frown: 'frown.mp4', look_away: 'away.mp4' } },
    at_ease: { poster: 'at-ease.jpg', clips: { nod: 'nod.mp4' } },
  },
  transitions: { 'guarded>at_ease': 'relax.mp4' },
};

/** A video element that "plays" instantly; ended() finishes it. */
function fakeVideo() {
  const el = document.createElement('video');
  Object.defineProperty(el, 'duration', { value: 4, configurable: true });
  // "Plays" at once, and its first frame is drawn right after.
  el.play = vi.fn(async () => void setTimeout(() => el.dispatchEvent(new Event('playing')), 0));
  el.pause = vi.fn();
  return Object.assign(el, { finish: () => el.onended?.(new Event('ended')) });
}

let el: ReturnType<typeof fakeVideo>;
let b: BodyLanguage;
beforeEach(async () => {
  vi.useRealTimers();
  URL.createObjectURL = vi.fn((x: Blob) => `blob:${(x as Blob & { name?: string }).size}`);
  URL.revokeObjectURL = vi.fn();
  el = fakeVideo();
  b = new BodyLanguage(manifest, '/avatars/ray', el);
  await b.load((async () => ({
    ok: true,
    blob: async () => new Blob(['x']),
  })) as unknown as typeof fetch);
});

describe('body language clips', () => {
  it('names the folder after the patient', () => {
    expect(patientSlug('Ray Kowalski')).toBe('ray-kowalski');
  });

  it('plays a clip for his mood over the live face, then fades back', async () => {
    expect(await b.cue(['nod'])).toBe(false); // no nod while guarded
    expect(await b.cue(['smile', 'frown'])).toBe(true);
    expect(el.classList.contains('on')).toBe(true);
    el.finish();
    expect(el.classList.contains('on')).toBe(false);
    // Not again right away (it would look like a loop).
    expect(await b.cue(['look_away'])).toBe(false);
  });

  it('fades in only once the clip’s first frame is drawn', async () => {
    el.play = vi.fn(async () => undefined); // its first frame never arrives on its own
    const cued = b.cue(['frown']);
    await new Promise((r) => setTimeout(r, 50));
    expect(el.classList.contains('on')).toBe(false);
    el.dispatchEvent(new Event('playing'));
    expect(await cued).toBe(true);
    expect(el.classList.contains('on')).toBe(true);
  });

  it('counts which clips played, and why others didn’t', async () => {
    await b.cue([]);
    await b.cue(['nod']); // no nod while guarded
    await b.cue(['frown']);
    await b.cue(['look_away']); // the frown is still playing
    el.finish();
    await b.cue(['look_away']); // too soon after the frown
    expect(b.stats.shown).toEqual({ frown: 1 });
    expect(b.stats.skipped).toEqual({
      'no cue': 1,
      'no guarded clip': 1,
      'clip already playing': 1,
      'too soon after the last': 1,
    });
  });

  it('gives way to his live face the moment he talks, and never plays over his words', async () => {
    await b.cue(['frown']);
    b.setSpeaking(true);
    expect(el.classList.contains('on')).toBe(false);
    expect(await b.cue(['look_away'])).toBe(false);
  });

  it('relaxes once he is quiet: the faces swap at the end of the transition', async () => {
    const onMood = vi.fn();
    b.onMood = onMood;
    b.setSpeaking(true);
    b.relax();
    expect(el.classList.contains('on')).toBe(false); // not while he talks
    b.setSpeaking(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(el.classList.contains('on')).toBe(true); // the transition clip
    expect(b.mood).toBe('at_ease');
    expect(b.poster).toBe('/avatars/ray/at-ease.jpg');
    expect(onMood).not.toHaveBeenCalled(); // the live face switches at its last frame
    el.finish();
    expect(onMood).toHaveBeenCalledWith('at_ease');
    expect(el.classList.contains('on')).toBe(true); // holds until the new face is up
    b.reveal();
    expect(el.classList.contains('on')).toBe(false);
    // Only once.
    onMood.mockClear();
    b.relax();
    expect(onMood).not.toHaveBeenCalled();
  });

  it('if he starts talking during the mood change, the faces swap at once', async () => {
    const onMood = vi.fn();
    b.onMood = onMood;
    b.relax();
    await new Promise((r) => setTimeout(r, 5));
    expect(el.classList.contains('on')).toBe(true);
    b.setSpeaking(true);
    expect(onMood).toHaveBeenCalledWith('at_ease');
    b.reveal();
    expect(el.classList.contains('on')).toBe(false);
  });

  it('connects his relaxed face first, and only then plays the transition', async () => {
    let ready!: (ok: boolean) => void;
    b.onPrepare = vi.fn(() => new Promise<boolean>((r) => (ready = r)));
    b.relax();
    expect(b.onPrepare).toHaveBeenCalledWith('at_ease');
    expect(el.classList.contains('on')).toBe(false);
    expect(b.mood).toBe('guarded');
    ready(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(el.classList.contains('on')).toBe(true);
    expect(b.mood).toBe('at_ease');
  });
});
