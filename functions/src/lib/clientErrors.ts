import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Caller } from './callable.js';

const input = z
  .object({
    kind: z.string().max(40),
    message: z.string().max(500),
    stack: z.string().max(2000).optional(),
    componentStack: z.string().max(1500).optional(),
    path: z.string().max(200).optional(),
    userAgent: z.string().max(300).optional(),
  })
  .strip();

/** Stores a client crash report for debugging. Server-only collection (no client reads). */
export async function reportClientError(db: Firestore, caller: Caller | null, data: unknown) {
  const r = input.safeParse(data);
  if (!r.success) return { ok: false };
  await db.collection('clientErrors').add({
    ...r.data,
    uid: caller?.uid ?? null,
    programId: (caller?.claims.programId as string | undefined) ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}
