import type { Auth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { dayKey } from '../lib/quota.js';

/** The conversation servers the app needs awake before a conversation. */
export const WARM_TARGETS = [
  'startSession',
  'getSttToken',
  'patientTurn',
  'tts',
  'startLiveCall',
  'avatarSession',
] as const;

export type AppCheckResult = 'valid' | 'invalid' | 'missing';

export async function checkAppCheck(req: Request): Promise<AppCheckResult> {
  const token = req.get('x-firebase-appcheck');
  if (!token) return 'missing';
  try {
    await getAppCheck().verifyToken(token);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

export interface WarmDeps {
  db: Firestore;
  auth: Auth;
  enforceAppCheck: boolean;
  appCheck: (req: Request) => Promise<AppCheckResult>;
  /** Wakes one server through its free warm-up path. */
  wake: (name: (typeof WARM_TARGETS)[number], headers: Record<string, string>) => Promise<unknown>;
}

/**
 * POST /warm: the free keep-warm route. Signed-in users only. Records whether
 * the app sent a valid App Check token (so we can confirm tokens arrive
 * before turning on enforcement), then wakes the conversation servers through
 * their warm-up path, which answers before any paid service (Claude, voice,
 * speech-to-text) is called.
 */
export async function handleWarm(req: Request, res: Response, deps: WarmDeps) {
  if (req.method !== 'POST') return void res.status(405).end();
  const authHeader = req.get('authorization') ?? '';
  const token = /^Bearer (.+)$/.exec(authHeader)?.[1];
  if (!token) return void res.status(401).json({ error: 'unauthenticated' });
  try {
    await deps.auth.verifyIdToken(token);
  } catch {
    return void res.status(401).json({ error: 'unauthenticated' });
  }

  const check = await deps.appCheck(req);
  await deps.db
    .doc(`appCheckStats/${dayKey()}`)
    .set(
      { [check]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    .catch(() => undefined);
  if (deps.enforceAppCheck && check !== 'valid')
    return void res.status(401).json({ error: 'app-check' });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: authHeader,
  };
  const ac = req.get('x-firebase-appcheck');
  if (ac) headers['X-Firebase-AppCheck'] = ac;
  await Promise.allSettled(WARM_TARGETS.map((name) => deps.wake(name, headers)));
  res.status(204).end();
}

/** Calls a function's warm-up path: callables take { data: { warmup: true } }. */
export function wakeOverHttp(project: string, region: string, emulator: boolean) {
  return async (name: string, headers: Record<string, string>) => {
    const url = emulator
      ? `http://127.0.0.1:5001/${project}/${region}/${name}`
      : `https://${region}-${project}.cloudfunctions.net/${name}`;
    const body = name === 'tts' ? { warmup: true } : { data: { warmup: true } };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
