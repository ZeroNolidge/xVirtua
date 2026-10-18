import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { SEED_JARGON } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';

export const STT_MODEL = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-transcribe';

const PROMPT_PREFIX =
  'A doctor talking with a patient in a clinic. Transcribe exactly what is said, including medical terms such as: ';
/** OpenAI caps the transcription prompt at 1024 characters. */
export const MAX_STT_PROMPT = 1000;

/** A hint so jargon is transcribed as spoken (not "corrected" into plain words). */
export function sttPrompt(): string {
  let out = PROMPT_PREFIX;
  for (const t of SEED_JARGON.filter((t) => t.category !== 'general' && t.term.length > 3)) {
    const next = `${out}${out === PROMPT_PREFIX ? '' : ', '}${t.term}`;
    if (next.length + 1 > MAX_STT_PROMPT) break;
    out = next;
  }
  return `${out}.`;
}

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

  await consumeQuota(db, caller.uid, 'sttTokens');
  const { value, expiresAt } = await mintClientSecret(apiKey);
  assertEphemeral(value, apiKey);
  return { value, expiresAt, model: STT_MODEL };
}

/**
 * The browser only uses the key to open its connection, right away, so it
 * expires after a minute. The open connection keeps working after that.
 */
export const STT_KEY_TTL_SECONDS = 60;

/**
 * Never hand the browser anything but a short-lived OpenAI client secret
 * ("ek_…"). Real API keys start with "sk-". Guards against a
 * misconfiguration ever exposing the real key.
 */
export function assertEphemeral(value: string, apiKey: string) {
  if (value.startsWith('sk-') || value === apiKey || apiKey.includes(value)) {
    console.error('Refusing to return a non-ephemeral speech key');
    throw new HttpsError('internal', 'Speech service misconfigured.');
  }
}

export function clientSecretBody() {
  return {
    // Transcription-only session: this key can't be used for chat, audio
    // generation or any other OpenAI API.
    expires_after: { anchor: 'created_at', seconds: STT_KEY_TTL_SECONDS },
    session: {
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: {
            model: STT_MODEL,
            language: 'en',
            prompt: sttPrompt(),
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
