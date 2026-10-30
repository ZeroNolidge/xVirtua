import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { SESSION_LIMITS, voiceGroupOf } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';
import { loadScenario } from '../session/scenario.js';

/**
 * Test: the patient as a lip-synced video face (Simli). The browser sends
 * Simli only the patient's voice, never the resident's. This mints a
 * short-lived session token so the Simli key stays on the server.
 */
export const SIMLI_TOKEN_URL = 'https://api.simli.ai/compose/token';
export const FACE_ID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const input = z.object({
  sessionId: z.string().min(1).max(64),
  /** Which of the patient's faces (guarded at first, at ease once he relaxes). */
  mood: z.enum(['guarded', 'at_ease']).nullish(),
});

type Fetch = typeof fetch;

export async function avatarSession(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  apiKey: string,
  doFetch: Fetch = fetch,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { sessionId, mood } = parse(input, data);
  const ref = db.doc(`sessions/${sessionId}`);
  const s = (await ref.get()).data();
  if (!s || s.uid !== caller.uid) throw new HttpsError('not-found', 'Session not found.');
  if (s.status !== 'live')
    throw new HttpsError('failed-precondition', 'This conversation has ended.');
  const program = (await db.doc(`programs/${s.programId}`).get()).data() ?? {};
  if (program.avatarOn !== true)
    throw new HttpsError('failed-precondition', 'The video avatar is off.');
  if (!apiKey || apiKey === 'unset')
    throw new HttpsError('unavailable', 'The video avatar isn’t set up.');
  const sc = await loadScenario(db, s.scenarioId, s.scenarioVersion);
  if (!sc) throw new HttpsError('not-found', 'Scenario not found.');
  const faces = (program.avatarFaces ?? {}) as Record<string, unknown>;
  const moodFaces = (program.avatarMoodFaces ?? {}) as Record<string, unknown>;
  const moodFace = mood ? String(moodFaces[mood] ?? '') : '';
  // A face for this mood if faculty chose one, else the face for the patient's pronouns.
  const faceId = FACE_ID.test(moodFace)
    ? moodFace
    : String(faces[voiceGroupOf(sc.briefing.persona.pronouns)] ?? '');
  if (!FACE_ID.test(faceId))
    throw new HttpsError('failed-precondition', 'No avatar face is chosen for this patient.');

  await consumeQuota(db, caller.uid, 'avatarSessions');
  const token = await mintSimliToken(faceId, apiKey, doFetch, SESSION_LIMITS.maxMinutes * 60);
  await ref.update({ avatarSessions: FieldValue.arrayUnion({ at: Date.now(), faceId }) });
  return { token };
}

/** Asks Simli for a session token for this face. */
async function mintSimliToken(
  faceId: string,
  apiKey: string,
  doFetch: Fetch,
  maxSessionLength: number,
): Promise<string> {
  const res = await doFetch(SIMLI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-simli-api-key': apiKey },
    body: JSON.stringify({
      faceId,
      // We stream the patient's voice, silence included.
      handleSilence: false,
      maxSessionLength,
      // Paused or left open: Simli hangs up (and stops billing) by itself.
      maxIdleTime: 120,
    }),
  }).catch((e: unknown) => {
    console.error('Simli unreachable', e);
    throw new HttpsError('unavailable', 'The video avatar is unreachable.');
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error('Simli token failed', res.status, raw.slice(0, 300));
    throw new HttpsError('unavailable', 'The video avatar is unavailable.', {
      status: res.status,
      detail: raw.slice(0, 300),
    });
  }
  let token: string;
  try {
    token = String((JSON.parse(raw) as { session_token?: unknown }).session_token ?? '');
  } catch {
    token = '';
  }
  if (!token) throw new HttpsError('unavailable', 'The video avatar returned no session.');
  return token;
}

const checkInput = z.object({ mood: z.enum(['guarded', 'at_ease']) });

/**
 * Faculty tool (Face check): a short Simli session for one of the patient's
 * mood faces, outside any conversation, to test the face and its clips.
 */
export async function faceCheckToken(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  apiKey: string,
  doFetch: Fetch = fetch,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (caller.claims.role !== 'faculty') throw new HttpsError('permission-denied', 'Faculty only.');
  const { mood } = parse(checkInput, data);
  const pid = caller.claims.programId;
  if (typeof pid !== 'string' || !pid) throw new HttpsError('permission-denied', 'No program.');
  const program = (await db.doc(`programs/${pid}`).get()).data() ?? {};
  if (program.avatarOn !== true)
    throw new HttpsError('failed-precondition', 'The video avatar is off.');
  if (!apiKey || apiKey === 'unset')
    throw new HttpsError('unavailable', 'The video avatar isn’t set up.');
  const moodFaces = (program.avatarMoodFaces ?? {}) as Record<string, unknown>;
  const faceId = String(moodFaces[mood] ?? '');
  if (!FACE_ID.test(faceId))
    throw new HttpsError('failed-precondition', `No ${mood.replace('_', '-')} face is set.`);
  await consumeQuota(db, caller.uid, 'avatarSessions');
  // A check takes about a minute; Simli hangs up after 3 regardless.
  return { token: await mintSimliToken(faceId, apiKey, doFetch, 180), faceId };
}
