/** Prints recent GPT-Live calls (Diagnose workflow): which request layout worked, and who wrote the replies. */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const snap = await getFirestore()
  .collection('sessions')
  .orderBy('startedAt', 'desc')
  .limit(40)
  .get();
const live = snap.docs.filter((d) => d.get('voiceMode') === 'live').slice(0, 6);
if (!live.length) console.log('No GPT-Live sessions yet.');
for (const d of live) {
  const s = d.data();
  console.log(
    `${d.id} ${s.startedAt?.toDate?.().toISOString()} turns=${s.turnCount} claudeReplies=${s.liveTurns ?? 0} selfReplies=${s.liveSelfReplies ?? 0} calls=${JSON.stringify(s.liveCalls ?? [])}`,
  );
}
