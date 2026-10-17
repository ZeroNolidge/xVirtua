import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { CONSENT_VERSION, type Role, type UserClaims } from '@plainspeak/shared';

/** The verified caller of a callable function. */
export interface Caller {
  uid: string;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  claims: Partial<UserClaims> & Record<string, unknown>;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .refine((e) => e.length <= 254);
const roleSchema = z.enum(['resident', 'faculty']);

function requireFaculty(caller: Caller | null): { uid: string; programId: string } {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { role, programId } = caller.claims;
  if (role !== 'faculty' || typeof programId !== 'string') {
    throw new HttpsError('permission-denied', 'Only faculty can manage invites.');
  }
  return { uid: caller.uid, programId };
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  return r.data;
}

/** Faculty invites a resident or another faculty member to their program. */
export async function createInvite(
  db: Firestore,
  auth: Auth,
  caller: Caller | null,
  data: unknown,
): Promise<{ email: string; role: Role }> {
  const fac = requireFaculty(caller);
  const { email, role } = parse(z.object({ email: emailSchema, role: roleSchema }), data);

  // Don't silently move someone who already belongs to a program.
  const existing = await auth.getUserByEmail(email).catch(() => null);
  if (existing?.customClaims?.programId) {
    throw new HttpsError('already-exists', 'That person already has an account.');
  }

  await db.doc(`invites/${email}`).set({
    email,
    role,
    programId: fac.programId,
    invitedBy: fac.uid,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { email, role };
}

/** Faculty withdraws a pending invite in their program. */
export async function revokeInvite(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<void> {
  const fac = requireFaculty(caller);
  const { email } = parse(z.object({ email: emailSchema }), data);
  const ref = db.doc(`invites/${email}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('programId') !== fac.programId) {
    throw new HttpsError('not-found', 'Invite not found.');
  }
  if (snap.get('status') !== 'pending') {
    throw new HttpsError('failed-precondition', 'Only pending invites can be revoked.');
  }
  await ref.update({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: fac.uid,
  });
}

export type ClaimResult =
  { status: 'ok'; role: Role; programId: string } | { status: 'not_invited' };

/**
 * Called right after sign-in. If the caller's email has a pending invite,
 * set role/program custom claims and create their user doc. If not, the
 * account is deleted (closed pilot, no open sign-up).
 */
export async function claimInvite(
  db: Firestore,
  auth: Auth,
  caller: Caller | null,
): Promise<ClaimResult> {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');

  // Already set up: idempotent.
  const { role: curRole, programId: curProgram } = caller.claims;
  if ((curRole === 'resident' || curRole === 'faculty') && typeof curProgram === 'string') {
    return { status: 'ok', role: curRole, programId: curProgram };
  }

  // Email-link sign-in proves ownership of the address.
  if (!caller.email || !caller.emailVerified) {
    throw new HttpsError('failed-precondition', 'Please sign in with the link we emailed you.');
  }
  const email = normalizeEmail(caller.email);
  const inviteRef = db.doc(`invites/${email}`);

  const result = await db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef);
    if (!invite.exists || invite.get('status') !== 'pending') return null;
    const role = invite.get('role') as Role;
    const programId = invite.get('programId') as string;
    tx.update(inviteRef, {
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedUid: caller.uid,
    });
    tx.set(db.doc(`users/${caller.uid}`), {
      email,
      role,
      programId,
      displayName: email.split('@')[0] ?? email,
      consent: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (role === 'resident') {
      tx.set(db.doc(`userProgress/${caller.uid}`), {
        programId,
        xp: 0,
        streak: { current: 0, longest: 0, lastDayLocal: null },
        badges: [],
        scenariosCompleted: [],
        cuesCaught: 0,
      });
    }
    return { role, programId };
  });

  if (!result) {
    await auth.deleteUser(caller.uid).catch(() => undefined);
    return { status: 'not_invited' };
  }

  const claims: UserClaims = { role: result.role, programId: result.programId };
  await auth.setCustomUserClaims(caller.uid, claims);
  return { status: 'ok', ...result };
}

/** Records consent for the current consent version. */
export async function acceptConsent(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<void> {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (typeof caller.claims.programId !== 'string') {
    throw new HttpsError('permission-denied', 'Your account is not set up yet.');
  }
  const { version } = parse(z.object({ version: z.number().int() }), data);
  if (version !== CONSENT_VERSION) {
    throw new HttpsError('failed-precondition', 'Please reload to see the latest consent form.');
  }
  await db.doc(`users/${caller.uid}`).update({
    consent: { version, acceptedAt: new Date().toISOString() },
  });
}
