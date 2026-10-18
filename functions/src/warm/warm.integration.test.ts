import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { Request, Response } from 'express';
import { dayKey } from '../lib/quota.js';
import { handleWarm, WARM_TARGETS, type AppCheckResult } from './warm.js';

let app: App;
let db: Firestore;
beforeAll(() => {
  app = initializeApp({ projectId: 'demo-plainspeak' }, 'warm-test');
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

const auth = {
  verifyIdToken: async (t: string) => {
    if (t !== 'good') throw new Error('bad token');
    return { uid: 'u1' };
  },
} as unknown as Auth;

function call(headers: Record<string, string>, check: AppCheckResult, enforce = false) {
  const woken: string[] = [];
  let status = 0;
  const req = {
    method: 'POST',
    get: (h: string) => headers[h.toLowerCase()],
  } as unknown as Request;
  const res = {
    status(n: number) {
      status = n;
      return this;
    },
    end() {},
    json() {},
  } as unknown as Response;
  return handleWarm(req, res, {
    db,
    auth,
    enforceAppCheck: enforce,
    appCheck: async () => check,
    wake: async (name) => void woken.push(name),
  }).then(() => ({ status, woken }));
}

describe('warm route', () => {
  it('requires sign-in and wakes nothing without it', async () => {
    expect(await call({}, 'valid')).toEqual({ status: 401, woken: [] });
    expect(await call({ authorization: 'Bearer nope' }, 'valid')).toEqual({
      status: 401,
      woken: [],
    });
  });

  it('wakes every conversation server and counts App Check tokens', async () => {
    const before = (await db.doc(`appCheckStats/${dayKey()}`).get()).data() ?? {};
    const r = await call({ authorization: 'Bearer good', 'x-firebase-appcheck': 'tok' }, 'valid');
    expect(r).toEqual({ status: 204, woken: [...WARM_TARGETS] });
    await call({ authorization: 'Bearer good' }, 'missing');
    const after = (await db.doc(`appCheckStats/${dayKey()}`).get()).data()!;
    expect(after.valid).toBe((before.valid ?? 0) + 1);
    expect(after.missing).toBe((before.missing ?? 0) + 1);
  });

  it('with enforcement on, refuses requests without a valid App Check token', async () => {
    expect(await call({ authorization: 'Bearer good' }, 'missing', true)).toEqual({
      status: 401,
      woken: [],
    });
  });
});
