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
  face: { enabled: boolean; ready: boolean; restart(mood: Mood): void },
) {
  const body = useRef<BodyLanguage | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [startMood, setStartMood] = useState<Mood | null>(null);
  const restart = useRef(face.restart);
  useEffect(() => {
    restart.current = face.restart;
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
      const b = new BodyLanguage(manifest, base, el);
      b.onMood = (m) => {
        setPoster(b.poster);
        restart.current(m);
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
    cue: (cues: readonly NonverbalCue[], maxWaitMs = 0) =>
      body.current && face.ready ? body.current.cue(cues, maxWaitMs) : Promise.resolve(false),
    setSpeaking: (on: boolean) => body.current?.setSpeaking(on),
    relax: () => body.current?.relax(),
    mood: (): Mood | null => body.current?.mood ?? null,
  };
}
