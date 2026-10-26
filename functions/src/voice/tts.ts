import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { Delivery } from '@plainspeak/shared';
import { pickVoice, synthesize } from './cartesia.js';
import { loadScenario } from '../session/scenario.js';
import { consumeQuota } from '../lib/quota.js';
import { appCheckOk } from '../lib/appCheck.js';

/**
 * POST { sessionId, turnIdx } with "Authorization: Bearer <Firebase ID token>".
 * Add `sentence` to speak just one sentence of that turn (it must be part of
 * the stored line). Speaks stored patient turns only, so the endpoint can't be used as a
 * general-purpose TTS proxy. Returns audio/mpeg.
 *
 * POST { warmup: true } (also signed in) just wakes the server: it returns 204
 * before any paid call.
 */
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export async function handleTts(
  req: Request,
  res: Response,
  db: Firestore,
  auth: Auth,
  key: string,
) {
  if (req.method !== 'POST') return void res.status(405).end();
  if (!(await appCheckOk(req))) return void res.status(401).json({ error: 'app-check' });
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

  const body = (req.body ?? {}) as {
    sessionId?: unknown;
    turnIdx?: unknown;
    warmup?: unknown;
    sentence?: unknown;
  };
  if (body.warmup === true) return void res.status(204).end();
  const { sessionId, turnIdx } = body;
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
  let text = turn.text as string;
  if (body.sentence !== undefined) {
    const said = [turn.text, turn.plannedText].map((x) => squash(String(x ?? '')));
    const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : '';
    if (!sentence || sentence.length > 600 || !said.some((x) => x.includes(squash(sentence))))
      return void res.status(400).json({ error: 'invalid-argument' });
    text = sentence;
  }

  try {
    await consumeQuota(db, uid, 'voice');
  } catch {
    return void res.status(429).json({ error: 'resource-exhausted' });
  }
  try {
    let voiceId = s.voiceId as string | undefined;
    if (!voiceId) {
      const sc = await loadScenario(db, s.scenarioId, s.scenarioVersion);
      voiceId = await pickVoice(key, sc?.briefing.persona.pronouns ?? 'they', s.scenarioId);
      await ref.update({ voiceId });
    }
    const audio = await synthesize(key, voiceId, text, turn.delivery as Delivery);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(audio));
  } catch (e) {
    console.error('tts failed', e);
    res.status(502).json({ error: 'tts-unavailable' });
  }
}
