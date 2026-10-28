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
  el.play = vi.fn(async () => undefined);
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

  it('gives way to his live face the moment he talks, and never plays over his words', async () => {
    await b.cue(['frown']);
    b.setSpeaking(true);
    expect(el.classList.contains('on')).toBe(false);
    expect(await b.cue(['look_away'])).toBe(false);
  });

  it('relaxes once he is quiet: the transition holds until the at-ease face is up', async () => {
    const onMood = vi.fn();
    b.onMood = onMood;
    b.setSpeaking(true);
    b.relax();
    expect(onMood).not.toHaveBeenCalled();
    b.setSpeaking(false);
    expect(onMood).toHaveBeenCalledWith('at_ease');
    expect(b.mood).toBe('at_ease');
    expect(b.poster).toBe('/avatars/ray/at-ease.jpg');
    el.finish(); // transition over, live face not up yet: hold the last frame
    expect(el.classList.contains('on')).toBe(true);
    b.reveal();
    expect(el.classList.contains('on')).toBe(false);
    // Only once.
    onMood.mockClear();
    b.relax();
    expect(onMood).not.toHaveBeenCalled();
  });
});
