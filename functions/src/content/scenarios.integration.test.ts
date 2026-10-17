import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { setScenarioStatus } from './scenarios.js';
import type { Caller } from '../lib/callable.js';

const PROJECT_ID = 'demo-plainspeak';
let app: App;
let db: Firestore;
const faculty: Caller = { uid: 'fac1', claims: { role: 'faculty', programId: 'irmc' } };
const otherFaculty: Caller = { uid: 'fac2', claims: { role: 'faculty', programId: 'other' } };
const resident: Caller = { uid: 'res1', claims: { role: 'resident', programId: 'irmc' } };

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'scenarios-test');
  db = getFirestore(app);
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('scenarios/htn').set({ programId: 'irmc', status: 'draft', title: 'HTN' });
});
afterAll(async () => {
  await deleteApp(app);
});

describe('setScenarioStatus', () => {
  it('lets faculty publish, unpublish and archive in their program', async () => {
    for (const status of ['active', 'draft', 'archived'] as const) {
      await setScenarioStatus(db, faculty, { scenarioId: 'htn', status });
      expect((await db.doc('scenarios/htn').get()).get('status')).toBe(status);
    }
    expect((await db.doc('scenarios/htn').get()).get('statusChangedBy')).toBe('fac1');
  });

  it('rejects residents, other programs, unknown scenarios and bad input', async () => {
    await expect(
      setScenarioStatus(db, resident, { scenarioId: 'htn', status: 'active' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      setScenarioStatus(db, otherFaculty, { scenarioId: 'htn', status: 'active' }),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      setScenarioStatus(db, faculty, { scenarioId: 'nope', status: 'active' }),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      setScenarioStatus(db, faculty, { scenarioId: 'htn', status: 'deleted' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      setScenarioStatus(db, faculty, { scenarioId: '../x', status: 'active' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await db.doc('scenarios/htn').get()).get('status')).toBe('draft');
  });
});
