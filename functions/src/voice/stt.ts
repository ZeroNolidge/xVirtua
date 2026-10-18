import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { SEED_JARGON } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';

export const STT_MODEL = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-transcribe';

/** A hint list so jargon is transcribed as spoken (not "corrected" into plain words). */
const TERM_HINT = SEED_JARGON.filter((t) => t.category !== 'general' && t.term.length > 3)
  .slice(0, 120)
  .map((t) => t.term)
  .join(', ');

const input = z.object({ sessionId: z.string().min(1).max(64) });

/**
 * Mints a short-lived OpenAI Realtime client secret for a transcription-only
 * session. The browser uses it to stream mic audio straight to OpenAI over
 * WebRTC; our API key never leaves the server.
 */
export async function getSttToken(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  apiKey: string,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { sessionId } = parse(input, data);
  const s = (await db.doc(`sessions/${sessionId}`).get()).data();
  if (!s || s.uid !== caller.uid) throw new HttpsError('not-found', 'Session not found.');
  if (s.status !== 'live')
    throw new HttpsError('failed-precondition', 'This conversation has ended.');

  const { value, expiresAt } = await mintClientSecret(apiKey);
  return { value, expiresAt, model: STT_MODEL };
}

export function clientSecretBody() {
  return {
    expires_after: { anchor: 'created_at', seconds: 600 },
    session: {
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: {
            model: STT_MODEL,
            language: 'en',
            prompt: `A doctor talking with a patient in a clinic. Transcribe exactly what is said, including medical terms such as: ${TERM_HINT}.`,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 900,
          },
        },
      },
    },
  };
}

/** Calls OpenAI for a short-lived client secret. Throws HttpsError('unavailable') with detail. */
export async function mintClientSecret(
  apiKey: string,
): Promise<{ value: string; expiresAt: number | null }> {
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(clientSecretBody()),
  }).catch((e: unknown) => {
    console.error('OpenAI unreachable', e);
    throw new HttpsError('unavailable', 'Speech service unreachable.');
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error('OpenAI client secret failed', res.status, detail);
    throw new HttpsError('unavailable', `Speech service unavailable (${res.status}).`, {
      status: res.status,
      detail,
    });
  }
  const body = (await res.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string };
  };
  const value = body.value ?? body.client_secret?.value;
  if (!value) throw new HttpsError('unavailable', 'Speech service returned no key.');
  return { value, expiresAt: body.expires_at ?? null };
}
