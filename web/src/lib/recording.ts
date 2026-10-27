import { ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from './firebase';
import { sessionApi } from './session';

/** Give up when the upload makes no progress for this long (a dropped connection). */
export const UPLOAD_STALL_MS = 20_000;

export interface RecordingJob {
  sessionId: string;
  programId: string;
  uid: string;
  blob: Blob;
  ext: string;
}

/**
 * Uploads the practice recording and attaches it to the session. Fails fast
 * when the connection drops (instead of the storage library's own retries,
 * which can run for 10 minutes), so the app can offer "Try again".
 */
export async function uploadRecording(
  job: RecordingJob,
  stallMs = UPLOAD_STALL_MS,
  /** 0–1, as the upload goes. */
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const path = `audio/${job.programId}/${job.uid}/${job.sessionId}/recording.${job.ext}`;
  const task = uploadBytesResumable(ref(storage, path), job.blob, {
    contentType: job.blob.type || 'audio/webm',
  });
  await new Promise<void>((resolve, reject) => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        task.cancel();
        reject(new Error('Upload stalled'));
      }, stallMs);
    };
    arm();
    task.on(
      'state_changed',
      (snap) => {
        arm();
        if (snap?.totalBytes) onProgress?.(snap.bytesTransferred / snap.totalBytes);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
      () => {
        window.clearTimeout(timer);
        resolve();
      },
    );
  });
  await sessionApi.end({ sessionId: job.sessionId, audioExt: job.ext });
}
