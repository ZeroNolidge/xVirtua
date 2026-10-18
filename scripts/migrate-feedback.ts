/**
 * One-time, safe to re-run: residents now see words, not numbers.
 * For each scored session: writes the resident's word-only feedback if it's
 * missing and removes the numeric `overall` from the session doc (which the
 * resident can read). Exact scores stay in the faculty-only scores record.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { bandFor, type ScoreDoc } from '@plainspeak/shared';
import { distinctFixes, toResidentFeedback } from '../functions/src/scoring/feedback.js';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const db = getFirestore();
let changed = 0;
for (const s of (await db.collection('sessions').where('overall', '>=', 0).get()).docs) {
  const fb = s.ref.collection('feedback').doc('current');
  if (!(await fb.get()).exists) {
    const sc = await s.ref.collection('scores').orderBy('createdAt', 'desc').limit(1).get();
    const score = sc.docs[0]?.data() as ScoreDoc | undefined;
    if (score) await fb.set(toResidentFeedback({ ...score, fixes: distinctFixes(score) }, null));
  }
  const overall = s.get('overall') as number;
  await s.ref.update({
    overall: FieldValue.delete(),
    feedbackBand: bandFor(overall),
    scoreState: 'done',
    scoredAt: s.get('scoredAt') ?? FieldValue.serverTimestamp(),
  });
  changed++;
}
console.log(`Moved ${changed} session score(s) out of residents' view.`);
