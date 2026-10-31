import { useEffect, useRef, useState, type RefObject } from 'react';
import type { NonverbalCue } from '@plainspeak/shared';
import { BodyLanguage, patientSlug, type ClipManifest, type Mood } from './bodyLanguage';
import { reportError } from './errorReport';
import type { AvatarElements } from '../components/AvatarStage';

/**
 * The patient's body-language clips (test), when the video face is on and the
 * patient has clips (web/public/avatars/<patient>/manifest.json).
 * `restartFace(mood)` switches the live face when he relaxes.
 */
export function useBodyLanguage(
  personaName: string,
  stage: RefObject<AvatarElements | null>,
  face: {
    enabled: boolean;
    ready: boolean;
    /** Connects his face for another mood in the background; resolves true when ready. */
    prepare?: (mood: Mood) => Promise<boolean>;
    /** Swaps to the prepared face at once; false if none is ready. */
    commit?: () => boolean;
    /** Switches the live face to another mood the slow way; resolves once it has. */
    restart(mood: Mood): Promise<void> | void;
    /** The live face showing now. */
    video?: () => HTMLVideoElement | null;
  },
) {
  const body = useRef<BodyLanguage | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [startMood, setStartMood] = useState<Mood | null>(null);
  const restart = useRef(face.restart);
  const prepare = useRef(face.prepare);
  const commit = useRef(face.commit);
  const liveVideo = useRef(face.video);
  useEffect(() => {
    restart.current = face.restart;
    prepare.current = face.prepare;
    commit.current = face.commit;
    liveVideo.current = face.video;
  });

  useEffect(() => {
    if (!face.enabled) return;
    let live = true;
    const base = `/avatars/${patientSlug(personaName)}`;
    (async () => {
      const r = await fetch(`${base}/manifest.json`);
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) return;
      const manifest = (await r.json()) as ClipManifest;
      const el = stage.current?.clip;
      if (!live || !el) return;
      const b = new BodyLanguage(
        manifest,
        base,
        el,
        () => liveVideo.current?.() ?? stage.current?.video ?? null,
      );
      b.onPrepare = (m) => prepare.current?.(m) ?? Promise.resolve(false);
      b.onMood = (m) => {
        setPoster(b.poster);
        // His new face is already connected: swap at once. Otherwise the slow
        // way, while the transition clip holds on its last frame.
        if (commit.current?.()) return b.reveal();
        void Promise.resolve(restart.current(m))
          .catch(() => undefined)
          .then(() => b.reveal());
      };
      body.current = b;
      setPoster(b.poster);
      setStartMood(b.mood);
      await b.load();
    })().catch((e: unknown) => reportError('body.load', e));
    return () => {
      live = false;
      body.current?.dispose();
      body.current = null;
    };
  }, [face.enabled, personaName, stage]);

  // The live face for his new mood is up.
  useEffect(() => {
    if (face.ready) body.current?.reveal();
  }, [face.ready]);

  return {
    poster,
    /** The mood the live face should start in (null: no clips for this patient). */
    startMood,
    /** Plays a fitting clip; resolves when it's nearly done (at most `maxWaitMs`). */
    cue: (cues: readonly NonverbalCue[], maxWaitMs = 0) => {
      if (!body.current) return Promise.resolve(false);
      if (!face.ready) {
        body.current.skip('face not up');
        return Promise.resolve(false);
      }
      return body.current.cue(cues, maxWaitMs);
    },
    /** This session's clip counts (null: no clips for this patient). */
    stats: () => (body.current ? structuredClone(body.current.stats) : null),
    setSpeaking: (on: boolean) => body.current?.setSpeaking(on),
    relax: () => body.current?.relax(),
    /** The patient's mood should now be this (they move there one step at a time). */
    moveTo: (m: Mood) => body.current?.moveTo(m),
    mood: (): Mood | null => body.current?.mood ?? null,
    /** The body language that fits what he just said (his own words first). */
    cueFor: (text: string): NonverbalCue | null => body.current?.cueFor(text) ?? null,
  };
}
