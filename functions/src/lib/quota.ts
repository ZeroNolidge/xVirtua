import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { DAILY_LIMITS, DEFAULT_TIMEZONE, type DailyLimitKind } from '@plainspeak/shared';

/** Today's date in the program's timezone, e.g. "2026-10-18". */
export function dayKey(now = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const MESSAGES: Record<DailyLimitKind, string> = {
  sessions: 'You’ve reached today’s limit of practice conversations. Come back tomorrow!',
  patientTurns: 'You’ve reached today’s limit for patient replies. Come back tomorrow!',
  sttTokens: 'You’ve reached today’s limit for voice connections. You can type instead.',
  voice: 'You’ve reached today’s limit for the patient’s voice. Their words will show as text.',
  lookups: 'You’ve reached today’s limit for word lookups.',
  scoring: 'You’ve reached today’s limit for feedback reports. Come back tomorrow!',
  liveCalls: 'You’ve reached today’s limit for live voice calls.',
  avatarSessions: 'You’ve reached today’s limit for the video avatar.',
};

/**
 * Counts one use of a paid service against the caller's daily cap and throws
 * resource-exhausted once it's used up. Stored at usage/{uid}/days/{date}
 * (server-only).
 */
export async function consumeQuota(
  db: Firestore,
  uid: string,
  kind: DailyLimitKind,
  amount = 1,
  limits: Record<DailyLimitKind, number> = DAILY_LIMITS,
): Promise<void> {
  const ref = db.doc(`usage/${uid}/days/${dayKey()}`);
  await db.runTransaction(async (tx) => {
    const used = ((await tx.get(ref)).get(kind) as number | undefined) ?? 0;
    if (used + amount > limits[kind]) throw new HttpsError('resource-exhausted', MESSAGES[kind]);
    tx.set(ref, { [kind]: FieldValue.increment(amount), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
