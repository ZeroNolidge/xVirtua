import { HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import type { UserClaims } from '@plainspeak/shared';

/** The verified caller of a callable function. */
export interface Caller {
  uid: string;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  claims: Partial<UserClaims> & Record<string, unknown>;
}


export function requireFaculty(caller: Caller | null): { uid: string; programId: string } {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { role, programId } = caller.claims;
  if (role !== 'faculty' || typeof programId !== 'string') {
    throw new HttpsError('permission-denied', 'Only faculty can do that.');
  }
  return { uid: caller.uid, programId };
}

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  return r.data;
}

