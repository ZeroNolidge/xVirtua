import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { tallyWords } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';
import { STT_MODEL, sttPrompt } from './stt.js';

const input = z.object({ sessionId: z.string().min(1).max(64) });

/** OpenAI's upload limit for transcription. */
const MAX_BYTES = 24 * 1024 * 1024;

const TYPE: Record<string, string> = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
};

/**
 * Speech clarity for a live-mode conversation, measured afterwards from its
 * recording (the resident's mic only): GPT-Live's own transcript has no word
 * confidence, and a second transcriber running during the call disturbed
 * the call's audio on Android. Standard mode measures it as it goes.
 * Saves counts only (words, and words heard clearly).
 */
export async function measureSpeech(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  apiKey: string,
  readAudio: (path: string) => Promise<Buffer | null>,
  doFetch: typeof fetch = fetch,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { sessionId } = parse(input, data);
  const ref = db.doc(`sessions/${sessionId}`);
  const s = (await ref.get()).data();
  if (!s || s.uid !== caller.uid) throw new HttpsError('not-found', 'Session not found.');
  // Already measured (standard mode does it during the conversation).
  if (s.speechStats) return { measured: false as const };
  const path = typeof s.audioPath === 'string' ? s.audioPath : '';
  if (!path) return { measured: false as const };
  if (!apiKey || apiKey === 'unset') return { measured: false as const };
  await consumeQuota(db, caller.uid, 'sttTokens');

  const audio = await readAudio(path);
  if (!audio || audio.length > MAX_BYTES) return { measured: false as const };
  const ext = path.split('.').pop() ?? 'webm';
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: TYPE[ext] ?? 'audio/webm' }),
    `recording.${ext}`,
  );
  form.append('model', STT_MODEL);
  form.append('response_format', 'json');
  form.append('language', 'en');
  form.append('prompt', sttPrompt());
  form.append('include[]', 'logprobs');
  const res = await doFetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }).catch((e: unknown) => {
    console.error('OpenAI unreachable (clarity)', e);
    return null;
  });
  if (!res?.ok) {
    console.warn('clarity transcription failed', res?.status, (await res?.text())?.slice(0, 300));
    return { measured: false as const };
  }
  const body = (await res.json()) as { logprobs?: { token: string; logprob: number }[] };
  if (!body.logprobs?.length) return { measured: false as const };
  const speechStats = tallyWords(body.logprobs);
  await ref.update({ speechStats, speechMeasuredAt: FieldValue.serverTimestamp() });
  return { measured: true as const, speechStats };
}
