/**
 * Prints how often body-language clips played in recent sessions, and why
 * others didn't (Diagnose workflow). Used to check that smoothing the
 * transitions isn't costing clips.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const snap = await getFirestore()
  .collection('sessions')
  .orderBy('startedAt', 'desc')
  .limit(60)
  .get();
const withStats = snap.docs.filter((d) => d.get('bodyStats')).slice(0, 10);
if (!withStats.length) console.log('No sessions with clip counts yet.');
const total = { shown: {} as Record<string, number>, skipped: {} as Record<string, number> };
const add = (into: Record<string, number>, from: Record<string, number> = {}) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};
for (const d of withStats) {
  const s = d.data();
  const b = s.bodyStats as {
    shown: Record<string, number>;
    skipped: Record<string, number>;
    stillWaitMs: number;
    relaxed: boolean;
  };
  const shown = Object.values(b.shown).reduce((a, n) => a + n, 0);
  console.log(
    `${d.id} ${s.startedAt?.toDate?.().toISOString()} ${s.voiceMode ?? 'standard'} ${s.durationSec ?? '?'}s` +
      ` played=${shown} ${JSON.stringify(b.shown)} skipped=${JSON.stringify(b.skipped)}` +
      ` stillWait=${shown ? Math.round(b.stillWaitMs / shown) : 0}ms/clip relaxed=${b.relaxed}`,
  );
  add(total.shown, b.shown);
  add(total.skipped, b.skipped);
}
if (withStats.length)
  console.log(
    `All of these: played ${JSON.stringify(total.shown)}; skipped ${JSON.stringify(total.skipped)}`,
  );
