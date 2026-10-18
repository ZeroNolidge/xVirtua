/** Prints how long the last patient replies took (Diagnose workflow). Times are from the server. */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const snap = await getFirestore()
  .collectionGroup('turns')
  .where('speaker', '==', 'patient')
  .orderBy('createdAt', 'desc')
  .limit(25)
  .get();
const rows = snap.docs.map((d) => d.data()).filter((t) => t.timing);
if (!rows.length) console.log('No timed replies yet.');
console.log('model              setup  first-words  first-voice  total   (ms)');
for (const t of rows) {
  const x = t.timing as Record<string, number>;
  console.log(
    `${String(t.model ?? '').padEnd(18)} ${String(x.preMs ?? '-').padStart(5)}  ${String(x.firstTextMs ?? '-').padStart(11)}  ${String(x.firstAudioMs ?? '-').padStart(11)}  ${String(x.totalMs ?? '-').padStart(5)}`,
  );
}
const first = rows
  .map((t) => t.timing.firstAudioMs)
  .filter((n) => typeof n === 'number')
  .sort((a, b) => a - b);
if (first.length)
  console.log(`Median time to first voice: ${first[Math.floor(first.length / 2)]} ms`);
