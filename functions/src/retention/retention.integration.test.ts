import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Caller } from '../lib/callable.js';
import {
  deleteResidentData,
  retentionSweep,
  setResidentEndDate,
  type AudioStore,
} from './retention.js';

const PROJECT_ID = 'demo-plainspeak';
let app: App;
let db: Firestore;
const faculty: Caller = { uid: 'fac1', claims: { role: 'faculty', programId: 'irmc' } };
const otherFaculty: Caller = { uid: 'fac9', claims: { role: 'faculty', programId: 'other' } };
const resident: Caller = { uid: 'res1', claims: { role: 'resident', programId: 'irmc' } };

/** In-memory audio bucket. */
function fakeAudio(files: Record<string, Date>) {
  const store: AudioStore = {
    deletePrefix: async (prefix) => {
      for (const f of Object.keys(files)) if (f.startsWith(prefix)) delete files[f];
    },
    listOld: async (prefix, olderThan) =>
      Object.entries(files)
        .filter(([f, d]) => f.startsWith(prefix) && d < olderThan)
        .map(([f]) => f),
    delete: async (p) => {
      delete files[p];
    },
  };
  return { store, files };
}

const ago = (days: number) => new Date(Date.now() - days * 86400000);

async function session(id: string, data: Record<string, unknown>) {
  await db
    .doc(`sessions/${id}`)
    .set({ uid: 'res1', programId: 'irmc', status: 'ended', startedAt: Timestamp.now(), ...data });
  await db.doc(`sessions/${id}/turns/0`).set({ idx: 0, speaker: 'patient', text: 'hi' });
  await db.doc(`sessions/${id}/scores/v1`).set({ overall: 80 });
}

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'retention-test');
  db = getFirestore(app);
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('users/res1').set({ programId: 'irmc', role: 'resident', email: 'res1@x.org' });
  await db.doc('users/res2').set({ programId: 'irmc', role: 'resident', email: 'res2@x.org' });
});
afterAll(async () => {
  await deleteApp(app);
});

describe('nightly retention sweep', () => {
  it('deletes sessions past 3 years (with turns, scores and audio) and keeps newer ones', async () => {
    const { store, files } = fakeAudio({
      'audio/irmc/res1/old/recording.webm': ago(1100),
      'audio/irmc/res1/new/recording.webm': ago(10),
    });
    await session('old', {
      deleteAfter: Timestamp.fromDate(ago(1)),
      audioPath: 'audio/irmc/res1/old/recording.webm',
    });
    await session('legacy', { startedAt: Timestamp.fromDate(ago(1100)) }); // from before deleteAfter existed
    await session('new', {
      deleteAfter: Timestamp.fromDate(ago(-900)),
      audioPath: 'audio/irmc/res1/new/recording.webm',
    });
    const r = await retentionSweep(db, store);
    expect(r.expiredSessions).toBe(2);
    expect((await db.doc('sessions/old').get()).exists).toBe(false);
    expect((await db.collection('sessions/old/turns').get()).size).toBe(0);
    expect((await db.collection('sessions/old/scores').get()).size).toBe(0);
    expect((await db.doc('sessions/legacy').get()).exists).toBe(false);
    expect((await db.doc('sessions/new').get()).exists).toBe(true);
    expect(Object.keys(files)).toEqual(['audio/irmc/res1/new/recording.webm']);
  });

  it('deletes everything for residents whose graduation date has passed', async () => {
    const { store, files } = fakeAudio({ 'audio/irmc/res1/a/recording.webm': ago(5) });
    await session('a', { audioPath: 'audio/irmc/res1/a/recording.webm' });
    await session('b', { uid: 'res2' });
    await db.doc('users/res1').update({ endDate: Timestamp.fromDate(ago(1)) });
    await db.doc('users/res2').update({ endDate: Timestamp.fromDate(ago(-30)) });
    const r = await retentionSweep(db, store);
    expect(r.residentsCleared).toBe(1);
    expect((await db.doc('sessions/a').get()).exists).toBe(false);
    expect((await db.doc('sessions/b').get()).exists).toBe(true);
    expect(files).toEqual({});
    expect((await db.doc('users/res1').get()).get('dataDeletedAt')).toBeTruthy();
    const log = await db.collection('auditLog').where('targetUid', '==', 'res1').get();
    expect(log.docs[0]!.get('action')).toBe('resident-data-deleted');
  });

  it('closes conversations left open so they count, and removes unlinked audio', async () => {
    const { store, files } = fakeAudio({
      'audio/irmc/res1/live1/recording.webm': ago(3), // never linked
      'audio/irmc/res1/fresh/recording.webm': ago(0.1), // too new to judge
    });
    await session('live1', {
      status: 'live',
      startedAt: Timestamp.fromDate(new Date(Date.now() - 50 * 60000)),
      lastActivityAt: Timestamp.fromDate(new Date(Date.now() - 45 * 60000)),
    });
    const r = await retentionSweep(db, store);
    expect(r.idleSessionsClosed).toBe(1);
    const s = (await db.doc('sessions/live1').get()).data()!;
    expect(s).toMatchObject({ status: 'ended', endedReason: 'left-open', durationSec: 300 });
    expect(r.unlinkedAudio).toBe(1);
    expect(Object.keys(files)).toEqual(['audio/irmc/res1/fresh/recording.webm']);
  });
});

describe('faculty data actions', () => {
  it('only program faculty can set an end date or delete a resident’s data', async () => {
    await expect(
      setResidentEndDate(db, resident, { uid: 'res1', endDate: '2027-06-30' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      setResidentEndDate(db, otherFaculty, { uid: 'res1', endDate: '2027-06-30' }),
    ).rejects.toMatchObject({ code: 'not-found' });
    await setResidentEndDate(db, faculty, { uid: 'res1', endDate: '2027-06-30' });
    const end = (await db.doc('users/res1').get()).get('endDate') as Timestamp;
    expect(end.toDate().toISOString().slice(0, 10)).toBe('2027-07-01'); // end of that day, Eastern = next day UTC

    const { store } = fakeAudio({});
    await session('x', {});
    await expect(
      deleteResidentData(db, store, faculty, { uid: 'res1', confirmEmail: 'wrong@x.org' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    const r = await deleteResidentData(db, store, faculty, {
      uid: 'res1',
      confirmEmail: 'RES1@x.org',
    });
    expect(r.sessions).toBe(1);
    expect((await db.doc('sessions/x').get()).exists).toBe(false);
    expect((await db.doc('users/res1').get()).exists).toBe(true); // account stays
  });
});
