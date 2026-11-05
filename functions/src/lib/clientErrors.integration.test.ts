import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { appCheckStatus, reportClientError, REPORTS_PER_HOUR } from './clientErrors.js';

let app: App;
let db: Firestore;
beforeAll(() => {
  app = initializeApp({ projectId: 'demo-plainspeak' }, 'client-errors-test');
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

const report = { kind: 'appCheck', message: 'App Check failed', path: '/' };

describe('client error reports', () => {
  it('a report with no App Check token is stored, marked "missing"', async () => {
    const r = await reportClientError(db, null, report, { ip: '10.0.0.1' });
    expect(r).toEqual({ ok: true });
    const snap = await db.collection('clientErrors').where('message', '==', 'App Check failed').get();
    expect(snap.docs.map((d) => d.get('appCheck'))).toContain('missing');
  });

  it('marks tokens valid or invalid, without ever throwing', async () => {
    expect(await appCheckStatus('t', async () => ({}))).toBe('valid');
    expect(
      await appCheckStatus('t', async () => {
        throw new Error('bad token');
      }),
    ).toBe('invalid');
  });

  it('drops the 21st report in an hour from the same sender', async () => {
    const ip = '10.0.0.2';
    const results = [];
    for (let i = 0; i < REPORTS_PER_HOUR + 1; i++)
      results.push(await reportClientError(db, null, { ...report, message: `burst ${i}` }, { ip }));
    expect(results.filter((r) => r.ok)).toHaveLength(REPORTS_PER_HOUR);
    expect(results[REPORTS_PER_HOUR]).toEqual({ ok: false, dropped: true });
    // A signed-in user has their own allowance.
    const user = { uid: 'u-burst', claims: { role: 'resident', programId: 'irmc' } } as never;
    expect(await reportClientError(db, user, report, { ip })).toEqual({ ok: true });
  });
});
