import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { CONSENT_VERSION } from '@plainspeak/shared';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';
import { endSession, patientTurn, startSession } from './session.js';
import { FakeBrain } from '../patient/fakeBrain.js';
import type { Caller } from '../lib/callable.js';

const PROJECT_ID = 'demo-plainspeak';
let app: App;
let db: Firestore;
const resident: Caller = { uid: 'res1', claims: { role: 'resident', programId: 'irmc' } };
const otherResident: Caller = { uid: 'res2', claims: { role: 'resident', programId: 'irmc' } };
const faculty: Caller = { uid: 'fac1', claims: { role: 'faculty', programId: 'irmc' } };
const htn = SEED_SCENARIOS[0]!;

async function seedScenario(status: 'active' | 'draft') {
  const ref = db.doc(`scenarios/${htn.id}`);
  await ref.set({ programId: 'irmc', status, currentVersion: '1', title: htn.briefing.title });
  await ref.collection('versions').doc('1').set(htn.briefing);
  await ref.collection('versions').doc('1').collection('private').doc('script').set(htn.script);
}

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'session-test');
  db = getFirestore(app);
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('programs/irmc').set({ patientModel: 'claude-sonnet-5-5' });
  for (const u of ['res1', 'res2', 'fac1']) {
    await db.doc(`users/${u}`).set({ programId: 'irmc', consent: { version: CONSENT_VERSION } });
  }
  await seedScenario('active');
});
afterAll(async () => {
  await deleteApp(app);
});

describe('startSession', () => {
  it('creates a live session with the opening line as turn 0, using the program model', async () => {
    const r = await startSession(db, resident, { scenarioId: htn.id });
    expect(r.opening.text).toBe(htn.script.openingLine);
    expect(r.patientModel).toBe('claude-sonnet-5-5');
    const s = (await db.doc(`sessions/${r.sessionId}`).get()).data()!;
    expect(s).toMatchObject({
      uid: 'res1',
      programId: 'irmc',
      status: 'live',
      turnCount: 1,
      audioPath: null,
    });
    expect((await db.doc(`sessions/${r.sessionId}/turns/0`).get()).get('speaker')).toBe('patient');
  });

  it('requires consent', async () => {
    await db.doc('users/res1').set({ programId: 'irmc', consent: null });
    await expect(startSession(db, resident, { scenarioId: htn.id })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('only faculty can practice drafts, and only faculty can pick the model', async () => {
    await seedScenario('draft');
    await expect(startSession(db, resident, { scenarioId: htn.id })).rejects.toMatchObject({
      code: 'not-found',
    });
    const f = await startSession(db, faculty, { scenarioId: htn.id, model: 'claude-haiku-5-5' });
    expect(f.patientModel).toBe('claude-haiku-5-5');
    await seedScenario('active');
    const r = await startSession(db, resident, { scenarioId: htn.id, model: 'claude-haiku-5-5' });
    expect(r.patientModel).toBe('claude-sonnet-5-5');
  });
});

describe('patientTurn', () => {
  it('saves both turns, fires scripted cues, and records cue context for scoring', async () => {
    const brain = new FakeBrain();
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });

    const r1 = await patientTurn(
      db,
      resident,
      { sessionId, text: 'Hi Ray. Your blood pressure is high.', source: 'typed' },
      brain,
    );
    expect(r1.patient.cueId).toBeUndefined();

    const r2 = await patientTurn(
      db,
      resident,
      { sessionId, text: 'I think we should start a pill for it.' },
      brain,
    );
    expect(r2.patient.cueId).toBe('job-worry');
    expect(brain.calls[1]!.message).toContain('DIRECTOR NOTE');
    expect(brain.calls[1]!.history.length).toBe(2); // resident 1 + patient 2

    const r3 = await patientTurn(
      db,
      resident,
      { sessionId, text: 'That is a fair worry. Treated blood pressure usually keeps your card.' },
      brain,
    );
    expect(r3.patient.idx).toBe(6);

    const turns = (
      await db.collection(`sessions/${sessionId}/turns`).orderBy('idx').get()
    ).docs.map((d) => d.data());
    expect(turns.map((t) => t.speaker)).toEqual([
      'patient',
      'resident',
      'patient',
      'resident',
      'patient',
      'resident',
      'patient',
    ]);
    expect(turns[5]).toMatchObject({ afterPatientCueId: 'job-worry', speaker: 'resident' });
    expect(turns[1]).toMatchObject({ source: 'typed', understandingCheck: null });
    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s.turnCount).toBe(7);
    expect(s.cueState.fired['job-worry']).toBe(1);
    expect(s.pending).toBe(false);
    expect(s.inputMode).toBe('mixed');
  });

  it('blocks other users, ended sessions and overlapping turns', async () => {
    const brain = new FakeBrain();
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    await expect(
      patientTurn(db, otherResident, { sessionId, text: 'hi' }, brain),
    ).rejects.toMatchObject({ code: 'not-found' });
    await db.doc(`sessions/${sessionId}`).update({ pending: true });
    await expect(patientTurn(db, resident, { sessionId, text: 'hi' }, brain)).rejects.toMatchObject(
      { code: 'aborted' },
    );
    await db.doc(`sessions/${sessionId}`).update({ pending: false, status: 'ended' });
    await expect(patientTurn(db, resident, { sessionId, text: 'hi' }, brain)).rejects.toMatchObject(
      { code: 'failed-precondition' },
    );
  });

  it('times out old sessions and releases the lock when the brain fails', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const failing = {
      reply: async () => {
        throw new Error('boom');
      },
    };
    await expect(
      patientTurn(db, resident, { sessionId, text: 'hi' }, failing),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect((await db.doc(`sessions/${sessionId}`).get()).get('pending')).toBe(false);
    expect((await db.collection(`sessions/${sessionId}/turns`).get()).size).toBe(1);
    await db
      .doc(`sessions/${sessionId}`)
      .update({ startedAt: Timestamp.fromMillis(Date.now() - 30 * 60000) });
    await expect(
      patientTurn(db, resident, { sessionId, text: 'hi' }, new FakeBrain()),
    ).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });
});

describe('endSession', () => {
  it('ends once, records duration, and attaches audio only if the upload exists', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id });
    const exists = new Set<string>();
    await endSession(db, resident, { sessionId }, async (p) => exists.has(p));
    const s = (await db.doc(`sessions/${sessionId}`).get()).data()!;
    expect(s.status).toBe('ended');
    expect(typeof s.durationSec).toBe('number');

    await expect(
      endSession(db, resident, { sessionId, audioExt: 'webm' }, async (p) => exists.has(p)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    const path = `audio/irmc/res1/${sessionId}/recording.webm`;
    exists.add(path);
    await endSession(db, resident, { sessionId, audioExt: 'webm' }, async (p) => exists.has(p));
    expect((await db.doc(`sessions/${sessionId}`).get()).get('audioPath')).toBe(path);
    await expect(
      endSession(db, otherResident, { sessionId }, async () => true),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('callable null handling', () => {
  it('accepts nulls for optional fields (how callable clients send missing values)', async () => {
    const { sessionId } = await startSession(db, resident, { scenarioId: htn.id, model: null });
    const r = await patientTurn(
      db,
      resident,
      { sessionId, text: 'Hello', source: 'typed', tStartMs: null, tEndMs: null },
      new FakeBrain(),
    );
    expect(r.patient.idx).toBe(2);
    await endSession(db, resident, { sessionId, audioExt: null }, async () => false);
  });
});
