import { useEffect, useRef, useState } from 'react';
import type { Mood } from '@plainspeak/shared';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth';
import { reportError } from './errorReport';
import { sessionApi } from './session';
import { PatientAvatar } from './avatar';
import type { AvatarElements } from '../components/AvatarStage';

/**
 * The patient's video face (test), when faculty turned it on. start() must
 * run inside the tap that starts or continues the conversation.
 */
export function useAvatar(sessionId: string) {
  const { claims } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  /** The face has shown at least once (the stage stays up while it reconnects). */
  const [everReady, setEverReady] = useState(false);
  const stage = useRef<AvatarElements | null>(null);
  const avatar = useRef<PatientAvatar | null>(null);

  useEffect(() => {
    if (!claims?.programId) return;
    let live = true;
    Promise.resolve()
      .then(() => getDoc(doc(db, 'programs', claims.programId)))
      .then((s) => live && setEnabled(s.get('avatarOn') === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [claims?.programId]);

  useEffect(
    () => () => {
      void avatar.current?.dispose();
    },
    [],
  );

  /** Creates the avatar (in the tap) and connects it. Resolves when it's up, or has failed. */
  function start(mood?: Mood): Promise<PatientAvatar | null> {
    if (!enabled || !stage.current) return Promise.resolve(null);
    if (!avatar.current) {
      const a = new PatientAvatar(stage.current.video, stage.current.audio, stage.current.spare);
      a.onChange = (r) => {
        setReady(r);
        if (r) setEverReady(true);
      };
      a.onFail = (e) => reportError('avatar', e);
      avatar.current = a;
    }
    const a = avatar.current;
    return a.connect(tokenFor(mood)).then((ok) => (ok ? a : null));
  }

  const tokenFor = (mood?: Mood) => async () =>
    (await sessionApi.avatarSession({ sessionId, ...(mood ? { mood } : {}) })).data.token;

  return {
    enabled,
    ready,
    everReady,
    stage,
    /** The avatar itself, once started (for wiring the patient's voice to it). */
    instance: () => avatar.current,
    start,
    stop: () => void avatar.current?.stop(),
    /** The face showing now (it changes when he switches mood). */
    video: () => avatar.current?.activeVideo ?? null,
    /** Connects his face for another mood in the background (the current one keeps going). */
    prepare: (mood: Mood) =>
      avatar.current?.prepareFace(tokenFor(mood)) ?? Promise.resolve(false),
    /** Swaps to the prepared face at once (no gap; the voice never moves). False: none ready. */
    commit: () => avatar.current?.commitFace() ?? false,
    /** Switches to the face for another mood the slow way (hang up, then start again). */
    restart: async (mood: Mood) => {
      if (!avatar.current) return;
      await avatar.current.stop();
      await start(mood);
    },
  };
}
