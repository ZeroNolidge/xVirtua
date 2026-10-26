/** Prints the 15 most recent client crash reports (used by the Diagnose workflow). */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const snap = await getFirestore()
  .collection('clientErrors')
  .orderBy('createdAt', 'desc')
  .limit(15)
  .get();
if (snap.empty) console.log('No client error reports.');
for (const d of snap.docs) {
  const e = d.data();
  console.log(
    `--- ${e.createdAt?.toDate?.().toISOString()} ${e.kind} ${e.path ?? ''} uid=${e.uid ?? '-'}`,
  );
  console.log(e.message);
  if (e.stack)
    console.log(
      String(e.stack)
        .split('\n')
        .slice(0, e.kind === 'live.events' ? 40 : 6)
        .join('\n'),
    );
  if (e.componentStack) console.log(String(e.componentStack).split('\n').slice(0, 6).join('\n'));
  console.log(e.userAgent ?? '');
}
