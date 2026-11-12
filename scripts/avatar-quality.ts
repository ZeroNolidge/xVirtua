/**
 * Prints what residents saw and heard from the video avatar in recent
 * sessions (Diagnose workflow): lip-sync delay, audio stutters, video
 * freezes. For before/after comparisons, and for Simli support.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const snap = await getFirestore()
  .collection('sessions')
  .orderBy('startedAt', 'desc')
  .limit(60)
  .get();
const rows = snap.docs.filter((d) => d.get('avatarStats')).slice(0, 12);
if (!rows.length) console.log('No sessions with avatar quality numbers yet.');
console.log(
  'session              started               mode      secs  delay med/max (n)   stutters  jitter  lost  freezes (ms)  fps   gaps (ms)',
);
for (const d of rows) {
  const s = d.data();
  const q = s.avatarStats as Record<string, number | null>;
  const n = (v: number | null | undefined, w: number) => String(v ?? '-').padStart(w);
  console.log(
    `${d.id} ${s.startedAt?.toDate?.().toISOString().slice(0, 19)} ${String(s.voiceMode ?? 'standard').padEnd(9)}` +
      ` ${n(q.seconds, 5)} ${n(q.delayMedianMs, 6)}/${String(q.delayMaxMs ?? '-').padEnd(5)} (${q.delayCount})` +
      ` ${n(q.audioStutters, 8)} ${n(q.audioJitterMs, 6)} ${n(q.packetsLost, 5)} ${n(q.videoFreezes, 7)} (${q.videoFreezeMs ?? '-'})` +
      ` ${n(q.fps, 5)} ${n(q.videoStalls, 5)} (${q.videoStallMs ?? '-'})`,
  );
}
