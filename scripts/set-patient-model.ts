/** Sets the patient model for every program (Deploy workflow input "patient_model"). */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const model = process.argv[2];
const allowed = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
if (!model || !allowed.includes(model)) {
  console.error(`Usage: set-patient-model <${allowed.join('|')}>`);
  process.exit(1);
}
initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const db = getFirestore();
for (const p of (await db.collection('programs').get()).docs) {
  await p.ref.update({ patientModel: model });
  console.log(`${p.id}: patient model → ${model}`);
}
