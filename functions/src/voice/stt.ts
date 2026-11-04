import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';

export const STT_MODEL = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-transcribe';

/** OpenAI caps the transcription prompt at 1024 characters. */
export const MAX_STT_PROMPT = 1000;

/**
 * A short, neutral context hint. We used to list ~100 medical terms here so
 * jargon was spelled right, but this model can "hear" its prompt in silence or
 * background noise and invent sentences full of those terms (seen in testing:
 * a whole line about triglycerides the resident never said). It spells
 * medical words well without the list.
 */
export function sttPrompt(): string {
  return 'A doctor talking with a patient in a family medicine clinic. Transcribe only what is actually said.';
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
  const { value, expiresAt, turnDetection } = await mintClientSecret(apiKey);
  assertEphemeral(value, apiKey);
  return { value, expiresAt, model: STT_MODEL, turnDetection };
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

/**
 * How the speech service decides the resident has finished a turn.
 * semantic: a model judges whether the words sound finished ("so the plan
 * is…" waits; "does that make sense?" ends quickly). Falls back to plain
 * silence detection if OpenAI rejects it.
 */
export type TurnDetection = 'semantic' | 'silence';

const TURN_DETECTION = {
  semantic: { type: 'semantic_vad', eagerness: 'low' },
  silence: {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 1000,
  },
} as const;

/**
 * `confidence`: also send the transcriber's confidence in each word (log
 * probabilities), for the speech clarity score.
 */
export function clientSecretBody(turn: TurnDetection = 'semantic', confidence = true) {
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
          turn_detection: TURN_DETECTION[turn],
        },
      },
      ...(confidence ? { include: ['item.input_audio_transcription.logprobs'] } : {}),
    },
  };
}

/** Calls OpenAI for a short-lived client secret. Throws HttpsError('unavailable') with detail. */
export async function mintClientSecret(
  apiKey: string,
): Promise<{ value: string; expiresAt: number | null; turnDetection: TurnDetection }> {
  const post = (turn: TurnDetection, confidence: boolean) =>
    fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(clientSecretBody(turn, confidence)),
    }).catch((e: unknown) => {
      console.error('OpenAI unreachable', e);
      throw new HttpsError('unavailable', 'Speech service unreachable.');
    });
  // Best first; if OpenAI rejects a setting, drop the word confidence (only
  // the clarity score needs it), then semantic turn detection.
  const tries: [TurnDetection, boolean][] = [
    ['semantic', true],
    ['semantic', false],
    ['silence', false],
  ];
  let turnDetection: TurnDetection = 'semantic';
  let res!: Response;
  for (const [i, [turn, confidence]] of tries.entries()) {
    turnDetection = turn;
    res = await post(turn, confidence);
    if (res.status !== 400 || i === tries.length - 1) break;
    console.warn('speech settings rejected', turn, confidence, (await res.text()).slice(0, 300));
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error('OpenAI client secret failed', res.status, detail);
    throw new HttpsError('unavailable', 'Speech service unavailable.', {
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
  return { value, expiresAt: body.expires_at ?? null, turnDetection };
}
