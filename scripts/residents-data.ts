/** Prints what the faculty Residents page reads: users (role, program) and ended sessions per user (Diagnose workflow). No names or emails. */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const db = getFirestore();
const users = await db.collection('users').get();
console.log(`users: ${users.size}`);
for (const d of users.docs) {
  const u = d.data();
  console.log(`  ${d.id.slice(0, 8)} role=${u.role} programId=${u.programId} nameSet=${!!u.displayName}`);
}
const sessions = await db.collection('sessions').get();
const tally = new Map<string, { live: number; ended: number; scored: number; noProgram: number }>();
for (const d of sessions.docs) {
  const s = d.data();
  const key = `${String(s.uid).slice(0, 8)} programId=${s.programId}`;
  const t = tally.get(key) ?? { live: 0, ended: 0, scored: 0, noProgram: 0 };
  if (s.status === 'ended') t.ended++;
  else t.live++;
  if (s.feedbackBand) t.scored++;
  if (!s.programId) t.noProgram++;
  tally.set(key, t);
}
console.log(`sessions: ${sessions.size}`);
for (const [k, t] of tally) console.log(`  ${k} ended=${t.ended} live=${t.live} scored=${t.scored}`);
