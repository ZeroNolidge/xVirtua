import { createHash } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';
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

/** At most this many reports per signed-in user (or per IP when signed out) each hour. */
export const REPORTS_PER_HOUR = 20;

export type AppCheckStatus = 'valid' | 'missing' | 'invalid';

/** Whether the report came with a valid App Check token. Never throws. */
export async function appCheckStatus(
  token: string | undefined,
  verify: (t: string) => Promise<unknown> = (t) => getAppCheck().verifyToken(t),
): Promise<AppCheckStatus> {
  if (!token) return 'missing';
  try {
    await verify(token);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

/** Counts this report against its sender's hourly limit; false when over it. */
async function underLimit(db: Firestore, key: string): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13); // e.g. 2026-11-05T14 (UTC)
  const ref = db.doc(`clientErrorLimits/${key}`);
  return db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() as { hour?: string; count?: number } | undefined;
    const count = d?.hour === hour ? (d.count ?? 0) : 0;
    if (count >= REPORTS_PER_HOUR) return false;
    tx.set(ref, { hour, count: count + 1 });
    return true;
  });
}

/**
 * Stores a client crash report for debugging. Server-only collection (no
 * client reads). Accepted without App Check (so a browser that fails App
 * Check can still say so) and when signed out; each report records its App
 * Check status, and senders are limited per hour (by user, or by a hash of
 * the IP when signed out).
 */
export async function reportClientError(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  ctx: { appCheckToken?: string; ip?: string } = {},
  verify?: (t: string) => Promise<unknown>,
) {
  const r = input.safeParse(data);
  if (!r.success) return { ok: false };
  const key = caller
    ? `u_${caller.uid}`
    : `ip_${createHash('sha256')
        .update(ctx.ip ?? 'unknown')
        .digest('hex')
        .slice(0, 32)}`;
  if (!(await underLimit(db, key))) return { ok: false, dropped: true };
  await db.collection('clientErrors').add({
    ...r.data,
    uid: caller?.uid ?? null,
    programId: (caller?.claims.programId as string | undefined) ?? null,
    appCheck: await appCheckStatus(ctx.appCheckToken, verify),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}
