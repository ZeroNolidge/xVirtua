import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { Delivery } from '@plainspeak/shared';
import { pickVoice, synthesize } from './cartesia.js';
import { loadScenario } from '../session/scenario.js';

/**
 * POST { sessionId, turnIdx } with "Authorization: Bearer <Firebase ID token>".
 * Speaks a stored patient turn only, so the endpoint can't be used as a
 * general-purpose TTS proxy. Returns audio/mpeg.
 */
export async function handleTts(
  req: Request,
  res: Response,
  db: Firestore,
  auth: Auth,
  key: string,
) {
  if (req.method !== 'POST') return void res.status(405).end();
  const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
  if (!token) return void res.status(401).json({ error: 'unauthenticated' });
  let uid: string;
  let programId: unknown;
  let role: unknown;
  try {
    const t = await auth.verifyIdToken(token);
    ({ uid, programId, role } = t as typeof t & { programId?: unknown; role?: unknown });
  } catch {
    return void res.status(401).json({ error: 'unauthenticated' });
  }

  const { sessionId, turnIdx } = (req.body ?? {}) as { sessionId?: unknown; turnIdx?: unknown };
  if (
    typeof sessionId !== 'string' ||
    !/^[A-Za-z0-9]{1,64}$/.test(sessionId) ||
    !Number.isInteger(turnIdx)
  ) {
    return void res.status(400).json({ error: 'invalid-argument' });
  }
  const ref = db.doc(`sessions/${sessionId}`);
  const s = (await ref.get()).data();
  const canHear = s && (s.uid === uid || (role === 'faculty' && s.programId === programId));
  if (!s || !canHear) return void res.status(404).json({ error: 'not-found' });
  const turn = (await ref.collection('turns').doc(String(turnIdx)).get()).data();
  if (!turn || turn.speaker !== 'patient') return void res.status(404).json({ error: 'not-found' });

  try {
    let voiceId = s.voiceId as string | undefined;
    if (!voiceId) {
      const sc = await loadScenario(db, s.scenarioId, s.scenarioVersion);
      voiceId = await pickVoice(key, sc?.briefing.persona.pronouns ?? 'they', s.scenarioId);
      await ref.update({ voiceId });
    }
    const audio = await synthesize(key, voiceId, turn.text as string, turn.delivery as Delivery);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(audio));
  } catch (e) {
    console.error('tts failed', e);
    res.status(502).json({ error: 'tts-unavailable' });
  }
}
