import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { DEFAULT_TRANSCRIPT_RETENTION_MONTHS, SESSION_LIMITS } from '@plainspeak/shared';
import { parse, requireFaculty, type Caller } from '../lib/callable.js';

/** The bits of a Cloud Storage bucket we use (easy to fake in tests). */
export interface AudioStore {
  deletePrefix(prefix: string): Promise<void>;
  /** Audio files older than `olderThan`, up to `limit`. */
  listOld(prefix: string, olderThan: Date, limit: number): Promise<string[]>;
  delete(path: string): Promise<void>;
}

interface SessionRow {
  uid: string;
  programId: string;
  audioPath?: string | null;
}

/** Deletes one session: its audio, transcript turns and scores. */
export async function deleteSession(db: Firestore, audio: AudioStore, ref: DocumentReference) {
  const s = (await ref.get()).data() as SessionRow | undefined;
  if (s) await audio.deletePrefix(`audio/${s.programId}/${s.uid}/${ref.id}/`);
  await db.recursiveDelete(ref);
}

/** Deletes everything a resident has recorded. Their account stays. */
export async function deleteAllForUser(
  db: Firestore,
  audio: AudioStore,
  uid: string,
  programId: string,
): Promise<number> {
  const sessions = await db.collection('sessions').where('uid', '==', uid).get();
  for (const d of sessions.docs) await deleteSession(db, audio, d.ref);
  // Also catches uploads that were never linked to a session.
  await audio.deletePrefix(`audio/${programId}/${uid}/`);
  await db.recursiveDelete(db.doc(`usage/${uid}`));
  return sessions.size;
}

function monthsAgo(now: Date, months: number) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

export interface SweepResult {
  expiredSessions: number;
  residentsCleared: number;
  idleSessionsClosed: number;
  unlinkedAudio: number;
}

/**
 * Nightly retention job:
 * 1. Deletes sessions past their delete-after date (at most 3 years).
 * 2. Deletes all data for residents whose graduation / leaving date has passed.
 * 3. Closes conversations left open (crashed or abandoned) so they count and can be scored.
 * 4. Deletes audio uploads that never got linked to a session.
 */
export async function retentionSweep(
  db: Firestore,
  audio: AudioStore,
  now = new Date(),
): Promise<SweepResult> {
  const out: SweepResult = {
    expiredSessions: 0,
    residentsCleared: 0,
    idleSessionsClosed: 0,
    unlinkedAudio: 0,
  };
  const ts = Timestamp.fromDate(now);

  // 1. Expired sessions. Older sessions have no deleteAfter, so also go by start date.
  const expired = new Map<string, DocumentReference>();
  for (const q of [
    db.collection('sessions').where('deleteAfter', '<=', ts).limit(500),
    db
      .collection('sessions')
      .where(
        'startedAt',
        '<=',
        Timestamp.fromDate(monthsAgo(now, DEFAULT_TRANSCRIPT_RETENTION_MONTHS)),
      )
      .limit(500),
  ]) {
    for (const d of (await q.get()).docs) expired.set(d.id, d.ref);
  }
  for (const ref of expired.values()) await deleteSession(db, audio, ref);
  out.expiredSessions = expired.size;

  // 2. Residents who graduated or left.
  const leaving = await db.collection('users').where('endDate', '<=', ts).get();
  for (const u of leaving.docs) {
    // Checked every night, so anything recorded after the end date goes too.
    const programId = u.get('programId') as string;
    const n = await deleteAllForUser(db, audio, u.id, programId);
    if (!n && u.get('dataDeletedAt')) continue;
    await u.ref.update({ dataDeletedAt: FieldValue.serverTimestamp() });
    await db.collection('auditLog').add({
      programId,
      action: 'resident-data-deleted',
      reason: 'end-date',
      targetUid: u.id,
      sessions: n,
      by: 'retention-job',
      at: FieldValue.serverTimestamp(),
    });
    out.residentsCleared++;
  }

  // 3. Conversations left open.
  const idleCutoff = Timestamp.fromMillis(now.getTime() - SESSION_LIMITS.idleMinutes * 60000);
  const idle = await db
    .collection('sessions')
    .where('status', '==', 'live')
    .where('lastActivityAt', '<=', idleCutoff)
    .limit(500)
    .get();
  for (const d of idle.docs) {
    const started = (d.get('startedAt') as Timestamp | undefined)?.toMillis() ?? now.getTime();
    const last = (d.get('lastActivityAt') as Timestamp | undefined)?.toMillis() ?? started;
    await d.ref.update({
      status: 'ended',
      endedReason: 'left-open',
      endedAt: FieldValue.serverTimestamp(),
      durationSec: Math.max(0, Math.round((last - started) / 1000)),
      pending: false,
    });
    out.idleSessionsClosed++;
  }

  // 4. Audio uploads with no session pointing at them (older than 2 days).
  const old = await audio.listOld('audio/', new Date(now.getTime() - 2 * 86400000), 1000);
  for (const path of old) {
    const sid = path.split('/')[3];
    const s = sid ? (await db.doc(`sessions/${sid}`).get()).data() : undefined;
    if (s?.audioPath === path) continue;
    await audio.delete(path);
    out.unlinkedAudio++;
  }
  return out;
}

// ---------- faculty actions ----------

const endDateInput = z.object({
  uid: z.string().min(1).max(128),
  /** YYYY-MM-DD, or null to clear. */
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

async function residentInProgram(db: Firestore, uid: string, programId: string) {
  const u = await db.doc(`users/${uid}`).get();
  if (!u.exists || u.get('programId') !== programId || u.get('role') !== 'resident') {
    throw new HttpsError('not-found', 'Resident not found.');
  }
  return u;
}

/**
 * Sets when a resident graduates or leaves. Their recordings and transcripts
 * are deleted by the nightly job once that date passes.
 */
export async function setResidentEndDate(db: Firestore, caller: Caller | null, data: unknown) {
  const me = requireFaculty(caller);
  const { uid, endDate } = parse(endDateInput, data);
  await residentInProgram(db, uid, me.programId);
  // End of that day, US Eastern (good enough for a nightly job).
  const ts = endDate ? Timestamp.fromDate(new Date(`${endDate}T23:59:00-05:00`)) : null;
  await db.doc(`users/${uid}`).update({ endDate: ts });
  await db.collection('auditLog').add({
    programId: me.programId,
    action: 'resident-end-date-set',
    targetUid: uid,
    endDate,
    by: me.uid,
    at: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

const deleteInput = z.object({
  uid: z.string().min(1).max(128),
  /** The resident's email, typed by faculty to confirm. */
  confirmEmail: z.string().min(3).max(320),
});

/** Faculty: delete one resident's recordings and transcripts now. */
export async function deleteResidentData(
  db: Firestore,
  audio: AudioStore,
  caller: Caller | null,
  data: unknown,
) {
  const me = requireFaculty(caller);
  const { uid, confirmEmail } = parse(deleteInput, data);
  const u = await residentInProgram(db, uid, me.programId);
  if (String(u.get('email') ?? '').toLowerCase() !== confirmEmail.trim().toLowerCase()) {
    throw new HttpsError('invalid-argument', 'The email doesn’t match this resident.');
  }
  const sessions = await deleteAllForUser(db, audio, uid, me.programId);
  await u.ref.update({ dataDeletedEarlyAt: FieldValue.serverTimestamp() });
  await db.collection('auditLog').add({
    programId: me.programId,
    action: 'resident-data-deleted',
    reason: 'faculty-request',
    targetUid: uid,
    sessions,
    by: me.uid,
    at: FieldValue.serverTimestamp(),
  });
  return { ok: true, sessions };
}
