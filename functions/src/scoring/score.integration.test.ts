import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { CONSENT_VERSION, RUBRIC_VERSION } from '@plainspeak/shared';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';
import type { Caller } from '../lib/callable.js';
import { patientTurn, startSession } from '../session/session.js';
import { FakeBrain } from '../patient/fakeBrain.js';
import { fakeScorer } from './fakeScorer.js';
import { scoreSession } from './score.js';

const PROJECT_ID = 'demo-plainspeak';
let app: App;
let db: Firestore;
const resident: Caller = { uid: 'res1', claims: { role: 'resident', programId: 'irmc' } };
const other: Caller = { uid: 'res2', claims: { role: 'resident', programId: 'irmc' } };
const faculty: Caller = { uid: 'fac1', claims: { role: 'faculty', programId: 'irmc' } };
const htn = SEED_SCENARIOS[0]!;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'score-test');
  db = getFirestore(app);
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('programs/irmc').set({ patientModel: 'claude-sonnet-5-5' });
  await db.doc('users/res1').set({ programId: 'irmc', consent: { version: CONSENT_VERSION } });
  const ref = db.doc(`scenarios/${htn.id}`);
  await ref.set({
    programId: 'irmc',
    status: 'active',
    currentVersion: '1',
    title: htn.briefing.title,
  });
  await ref.collection('versions').doc('1').set(htn.briefing);
  await ref.collection('versions').doc('1').collection('private').doc('script').set(htn.script);
});
afterAll(async () => {
  await deleteApp(app);
});

describe('scoreSession', () => {
  it('scores turns done so far (ending an open conversation), saves by rubric version, and reuses it', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await patientTurn(
      db,
      resident,
      { sessionId, text: 'Your hypertension needs treatment, Ray.' },
      new FakeBrain(),
    );
    let calls = 0;
    const base = fakeScorer();
    const scorer = async (s: string, u: string) => {
      calls++;
      return base(s, u);
    };

    await expect(scoreSession(db, other, { sessionId }, scorer)).rejects.toMatchObject({
      code: 'not-found',
    });
    const r = await scoreSession(db, resident, { sessionId }, scorer);
    expect(r.score).not.toBeNull();
    expect(r.score!.rubricVersion).toBe(RUBRIC_VERSION);
    expect(r.score!.metrics.jargon.flagged.map((f) => f.term)).toContain('hypertension');
    expect(r.score!.highlight?.quote).toBe('Your hypertension needs treatment, Ray.');
    expect(r.score!.fixes.length).toBeLessThanOrEqual(2);
    expect(r.score!.needsReview).toBe(false);
    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s).toMatchObject({
      status: 'ended',
      endedReason: 'scored-early',
      latestRubricVersion: RUBRIC_VERSION,
    });
    expect((await db.doc(`sessions/${sessionId}/scores/${RUBRIC_VERSION}`).get()).exists).toBe(
      true,
    );

    // Second view: cached, no new Claude call. Faculty can force a rescore.
    expect((await scoreSession(db, resident, { sessionId }, scorer)).cached).toBe(true);
    expect(calls).toBe(1);
    expect((await scoreSession(db, faculty, { sessionId, rescore: true }, scorer)).cached).toBe(
      false,
    );
    expect(calls).toBe(2);
  });

  it('returns nothing to score when the resident never spoke', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const r = await scoreSession(db, resident, { sessionId }, fakeScorer());
    expect(r).toMatchObject({ score: null, reason: 'no-turns' });
  });
});
