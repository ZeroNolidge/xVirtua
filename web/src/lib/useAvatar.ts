import { useEffect, useRef, useState } from 'react';
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
  function start(mood?: 'guarded' | 'at_ease'): Promise<PatientAvatar | null> {
    if (!enabled || !stage.current) return Promise.resolve(null);
    if (!avatar.current) {
      const a = new PatientAvatar(stage.current.video, stage.current.audio);
      a.onChange = (r) => {
        setReady(r);
        if (r) setEverReady(true);
      };
      a.onFail = (e) => reportError('avatar', e);
      avatar.current = a;
    }
    const a = avatar.current;
    return a
      .connect(
        async () =>
          (await sessionApi.avatarSession({ sessionId, ...(mood ? { mood } : {}) })).data.token,
      )
      .then((ok) => (ok ? a : null));
  }

  return {
    enabled,
    ready,
    everReady,
    stage,
    /** The avatar itself, once started (for wiring the patient's voice to it). */
    instance: () => avatar.current,
    start,
    stop: () => void avatar.current?.stop(),
    /** Switches to the face for another mood (hang up, then start again). */
    restart: async (mood: 'guarded' | 'at_ease') => {
      if (!avatar.current) return;
      await avatar.current.stop();
      await start(mood);
    },
  };
}
