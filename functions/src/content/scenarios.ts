import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  LIVE_VOICES,
  type LiveVoice,
  type ScenarioStatus,
  type ScenarioAvatar,
} from '@plainspeak/shared';
import { parse, requireFaculty, type Caller } from '../lib/callable.js';

const input = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  status: z.enum(['draft', 'active', 'archived']),
});

/** Faculty publish (active), unpublish (draft) or archive a scenario in their program. */
export async function setScenarioStatus(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<{ scenarioId: string; status: ScenarioStatus }> {
  const fac = requireFaculty(caller);
  const { scenarioId, status } = parse(input, data);
  const ref = db.doc(`scenarios/${scenarioId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('programId') !== fac.programId) {
    throw new HttpsError('not-found', 'Scenario not found.');
  }
  await ref.update({
    status,
    statusChangedBy: fac.uid,
    statusChangedAt: FieldValue.serverTimestamp(),
  });
  return { scenarioId, status };
}

const voiceInput = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  /** null: use the program's default voice for the patient's pronouns. */
  voice: z.enum(LIVE_VOICES).nullable(),
});

const FACE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ttsVoiceInput = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  /** null: a stable pick for the patient's pronouns. */
  voice: z.string().regex(FACE).nullable(),
});

/** Faculty pick the standard (Cartesia) voice for one patient in their program. */
export async function setScenarioTtsVoice(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<{ scenarioId: string; voice: string | null }> {
  const fac = requireFaculty(caller);
  const { scenarioId, voice } = parse(ttsVoiceInput, data);
  const ref = db.doc(`scenarios/${scenarioId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('programId') !== fac.programId)
    throw new HttpsError('not-found', 'Scenario not found.');
  await ref.update({ ttsVoice: voice, ttsVoiceChangedBy: fac.uid });
  return { scenarioId, voice };
}

const faceId = z.string().regex(FACE).or(z.literal('')).optional();
const avatarInput = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  faces: z.object({ guarded: faceId, upset: faceId, at_ease: faceId, happy: faceId }),
  background: faceId,
});

/**
 * Faculty give one patient their own Simli faces (by mood) and room. Empty
 * everywhere clears them (the built-in faces, or the program's, apply again).
 */
export async function setScenarioAvatar(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<{ scenarioId: string; avatar: ScenarioAvatar | null }> {
  const fac = requireFaculty(caller);
  const { scenarioId, faces, background } = parse(avatarInput, data);
  const ref = db.doc(`scenarios/${scenarioId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('programId') !== fac.programId)
    throw new HttpsError('not-found', 'Scenario not found.');
  const kept = Object.fromEntries(
    Object.entries(faces).filter(([, v]) => v),
  ) as ScenarioAvatar['faces'];
  if (Object.keys(kept).length && !kept.guarded)
    throw new HttpsError('invalid-argument', 'The guarded face is the one every visit starts on.');
  const avatar: ScenarioAvatar | null = Object.keys(kept).length
    ? { faces: kept, ...(background ? { background } : {}) }
    : null;
  await ref.update({ avatar, avatarChangedBy: fac.uid });
  return { scenarioId, avatar };
}

/** Faculty pick the GPT-Live voice for one patient in their program. */
export async function setScenarioVoice(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<{ scenarioId: string; voice: LiveVoice | null }> {
  const fac = requireFaculty(caller);
  const { scenarioId, voice } = parse(voiceInput, data);
  const ref = db.doc(`scenarios/${scenarioId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('programId') !== fac.programId) {
    throw new HttpsError('not-found', 'Scenario not found.');
  }
  await ref.update({ liveVoice: voice, liveVoiceChangedBy: fac.uid });
  return { scenarioId, voice };
}
