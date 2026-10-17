import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { CONSENT_VERSION } from '@plainspeak/shared';
import { acceptConsent, claimInvite, createInvite, revokeInvite, type Caller } from './invites.js';

const PROJECT_ID = 'demo-plainspeak';
let app: App;
let db: Firestore;
let auth: Auth;

const faculty: Caller = {
  uid: 'fac1',
  email: 'fac@irmc.org',
  emailVerified: true,
  claims: { role: 'faculty', programId: 'irmc' },
};
const resident: Caller = {
  uid: 'res1',
  email: 'res@irmc.org',
  emailVerified: true,
  claims: { role: 'resident', programId: 'irmc' },
};

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
}

async function newAuthUser(email: string): Promise<Caller> {
  const u = await auth.createUser({ email, emailVerified: true });
  return { uid: u.uid, email, emailVerified: true, claims: {} };
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Run with the emulators: npm run test:functions');
  }
  app = initializeApp({ projectId: PROJECT_ID }, 'invites-test');
  db = getFirestore(app);
  auth = getAuth(app);
});
beforeEach(clearEmulators);
afterAll(async () => {
  await deleteApp(app);
});

describe('createInvite', () => {
  it('lets faculty invite into their own program, normalizing the email', async () => {
    await createInvite(db, auth, faculty, { email: '  New.Res@IRMC.org ', role: 'resident' });
    const inv = await db.doc('invites/new.res@irmc.org').get();
    expect(inv.data()).toMatchObject({
      programId: 'irmc',
      role: 'resident',
      status: 'pending',
      invitedBy: 'fac1',
    });
  });

  it('rejects residents, signed-out callers and bad input', async () => {
    await expect(
      createInvite(db, auth, resident, { email: 'a@b.org', role: 'resident' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      createInvite(db, auth, null, { email: 'a@b.org', role: 'resident' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      createInvite(db, auth, faculty, { email: 'not-an-email', role: 'resident' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      createInvite(db, auth, faculty, { email: 'a@b.org', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('refuses to re-invite someone who already belongs to a program', async () => {
    const u = await auth.createUser({ email: 'taken@irmc.org' });
    await auth.setCustomUserClaims(u.uid, { role: 'resident', programId: 'other' });
    await expect(
      createInvite(db, auth, faculty, { email: 'taken@irmc.org', role: 'resident' }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('claimInvite', () => {
  it('sets claims, creates user + progress docs, and marks the invite accepted', async () => {
    await createInvite(db, auth, faculty, { email: 'res2@irmc.org', role: 'resident' });
    const caller = await newAuthUser('Res2@irmc.org');

    const r = await claimInvite(db, auth, caller);
    expect(r).toEqual({ status: 'ok', role: 'resident', programId: 'irmc' });

    const user = await auth.getUser(caller.uid);
    expect(user.customClaims).toEqual({ role: 'resident', programId: 'irmc' });
    expect((await db.doc(`users/${caller.uid}`).get()).data()).toMatchObject({
      role: 'resident',
      programId: 'irmc',
      consent: null,
    });
    expect((await db.doc(`userProgress/${caller.uid}`).get()).get('xp')).toBe(0);
    expect((await db.doc('invites/res2@irmc.org').get()).get('status')).toBe('accepted');
  });

  it('faculty invites do not create a progress doc', async () => {
    await createInvite(db, auth, faculty, { email: 'fac2@irmc.org', role: 'faculty' });
    const caller = await newAuthUser('fac2@irmc.org');
    expect(await claimInvite(db, auth, caller)).toMatchObject({ status: 'ok', role: 'faculty' });
    expect((await db.doc(`userProgress/${caller.uid}`).get()).exists).toBe(false);
  });

  it('deletes uninvited accounts', async () => {
    const caller = await newAuthUser('random@gmail.com');
    expect(await claimInvite(db, auth, caller)).toEqual({ status: 'not_invited' });
    await expect(auth.getUser(caller.uid)).rejects.toBeTruthy();
    expect((await db.doc(`users/${caller.uid}`).get()).exists).toBe(false);
  });

  it('does not honor revoked or already-used invites', async () => {
    await createInvite(db, auth, faculty, { email: 'rev@irmc.org', role: 'resident' });
    await revokeInvite(db, faculty, { email: 'rev@irmc.org' });
    expect(await claimInvite(db, auth, await newAuthUser('rev@irmc.org'))).toEqual({
      status: 'not_invited',
    });

    await createInvite(db, auth, faculty, { email: 'once@irmc.org', role: 'resident' });
    const first = await newAuthUser('once@irmc.org');
    await claimInvite(db, auth, first);
    // Simulate a second account on the same email (e.g. another provider) trying again.
    const second: Caller = {
      uid: 'other-uid',
      email: 'once@irmc.org',
      emailVerified: true,
      claims: {},
    };
    expect(await claimInvite(db, auth, second)).toEqual({ status: 'not_invited' });
  });

  it('requires a verified email', async () => {
    await createInvite(db, auth, faculty, { email: 'unv@irmc.org', role: 'faculty' });
    const caller: Caller = { uid: 'u', email: 'unv@irmc.org', emailVerified: false, claims: {} };
    await expect(claimInvite(db, auth, caller)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('is idempotent for already-claimed users', async () => {
    expect(await claimInvite(db, auth, resident)).toEqual({
      status: 'ok',
      role: 'resident',
      programId: 'irmc',
    });
  });
});

describe('revokeInvite', () => {
  it('only works within the faculty member’s program', async () => {
    await createInvite(db, auth, faculty, { email: 'x@irmc.org', role: 'resident' });
    const otherFaculty: Caller = {
      ...faculty,
      uid: 'f2',
      claims: { role: 'faculty', programId: 'other' },
    };
    await expect(revokeInvite(db, otherFaculty, { email: 'x@irmc.org' })).rejects.toMatchObject({
      code: 'not-found',
    });
    await revokeInvite(db, faculty, { email: 'x@irmc.org' });
    expect((await db.doc('invites/x@irmc.org').get()).get('status')).toBe('revoked');
  });
});

describe('acceptConsent', () => {
  it('records the current consent version', async () => {
    await db.doc('users/res1').set({ programId: 'irmc', role: 'resident', consent: null });
    await acceptConsent(db, resident, { version: CONSENT_VERSION });
    expect((await db.doc('users/res1').get()).get('consent.version')).toBe(CONSENT_VERSION);
  });

  it('rejects stale versions and unclaimed users', async () => {
    await db.doc('users/res1').set({ programId: 'irmc', role: 'resident', consent: null });
    await expect(
      acceptConsent(db, resident, { version: CONSENT_VERSION - 1 }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      acceptConsent(db, { uid: 'z', claims: {} }, { version: CONSENT_VERSION }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
