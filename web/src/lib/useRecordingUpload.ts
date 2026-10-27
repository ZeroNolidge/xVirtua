import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { reportError } from './errorReport';
import { uploadRecording, type RecordingJob } from './recording';

/**
 * Saves the recording after a conversation ends, then opens the feedback.
 * If the upload fails (e.g. the connection dropped), `failed` is set so the
 * screen can offer "Try again" or "Skip, see my feedback".
 */
export function useRecordingUpload(sessionId: string) {
  const nav = useNavigate();
  const { claims, user } = useAuth();
  const job = useRef<RecordingJob | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 0–1 while the recording uploads; null before it starts. */
  const [progress, setProgress] = useState<number | null>(null);
  const done = () => nav(`/session/${sessionId}/done`, { replace: true });

  async function attempt() {
    if (!job.current) return done();
    setBusy(true);
    try {
      setProgress(0);
      await uploadRecording(job.current, undefined, setProgress);
      job.current = null;
      done();
    } catch (e) {
      reportError('recording.upload', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return {
    failed,
    busy,
    progress,
    /** Upload this recording (or go straight to feedback if there is none). */
    async save(blob: Blob | null | undefined, ext: string) {
      if (blob && claims && user)
        job.current = { sessionId, programId: claims.programId, uid: user.uid, blob, ext };
      await attempt();
    },
    retry: () => void attempt(),
    skip: done,
  };
}
