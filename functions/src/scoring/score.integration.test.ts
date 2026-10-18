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
  it('scores once, gives the resident words only, keeps numbers for faculty, and never rescores on revisit', async () => {
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
    expect(r.score).toBeUndefined(); // residents never get the numbers
    const fb = r.feedback!;
    expect(fb.rubricVersion).toBe(RUBRIC_VERSION);
    expect(fb.overall).toMatchObject({ trend: 'first' });
    expect(['Just starting', 'Getting there', 'Solid', 'Strong']).toContain(fb.overall!.band);
    expect(fb.areas.jargon.flagged.map((f) => f.term)).toContain('hypertension');
    expect(fb.highlight?.quote).toBe('Your hypertension needs treatment, Ray.');
    // Two fixes from two different areas.
    expect(fb.fixes).toHaveLength(2);
    expect(new Set(fb.fixes.map((f) => f.metric)).size).toBe(2);
    // No 0–100 numbers anywhere in what the resident can read.
    const residentView =
      JSON.stringify(fb) + JSON.stringify((await db.doc(`sessions/${sessionId}`).get()).data());
    expect(residentView).not.toMatch(/"(score|overall)":\s*\d/);

    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s).toMatchObject({
      status: 'ended',
      endedReason: 'scored-early',
      latestRubricVersion: RUBRIC_VERSION,
      scoreState: 'done',
      feedbackBand: fb.overall!.band,
    });
    expect(s.overall).toBeUndefined();
    const full = (await db.doc(`sessions/${sessionId}/scores/${RUBRIC_VERSION}`).get()).data()!;
    expect(typeof full.overall).toBe('number');
    expect(typeof full.metrics.clarity.score).toBe('number');

    // Revisit: saved feedback, no new Claude call. Faculty can force a rescore and get numbers.
    expect((await scoreSession(db, resident, { sessionId }, scorer)).cached).toBe(true);
    expect(calls).toBe(1);
    const f = await scoreSession(db, faculty, { sessionId, rescore: true }, scorer);
    expect(f.cached).toBe(false);
    expect(typeof f.score!.overall).toBe('number');
    expect(calls).toBe(2);
  });

  it('a second request while scoring runs waits instead of scoring twice', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await patientTurn(db, resident, { sessionId, text: 'Hi Ray.' }, new FakeBrain());
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = fakeScorer();
    const slow = async (s: string, u: string) => {
      calls++;
      await gate;
      return base(s, u);
    };
    const firstCall = scoreSession(db, resident, { sessionId }, slow);
    await new Promise((r) => setTimeout(r, 300));
    await expect(scoreSession(db, resident, { sessionId }, slow)).rejects.toMatchObject({
      code: 'aborted',
    });
    release();
    await firstCall;
    expect(calls).toBe(1);
  });

  it('shows a trend against the previous scored conversation', async () => {
    const one = await startSession(db, resident, { scenarioId: htn.id });
    await patientTurn(
      db,
      resident,
      { sessionId: one.sessionId, text: 'Hello Ray.' },
      new FakeBrain(),
    );
    await scoreSession(db, resident, { sessionId: one.sessionId }, fakeScorer());
    // Pretend the first one scored much lower.
    const v = `sessions/${one.sessionId}/scores/${RUBRIC_VERSION}`;
    await db.doc(v).update({ overall: 40 });
    await new Promise((r) => setTimeout(r, 20));
    const two = await startSession(db, resident, { scenarioId: htn.id });
    await patientTurn(
      db,
      resident,
      { sessionId: two.sessionId, text: 'Hello again Ray.' },
      new FakeBrain(),
    );
    const r = await scoreSession(db, resident, { sessionId: two.sessionId }, fakeScorer());
    expect(r.feedback!.overall!.trend).toBe('up');
  });

  it('returns nothing to score when the resident never spoke', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const r = await scoreSession(db, resident, { sessionId }, fakeScorer());
    expect(r).toMatchObject({ feedback: null, reason: 'no-turns' });
  });
});
