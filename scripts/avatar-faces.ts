/** Prints the Simli face IDs saved in each program's settings (Diagnose workflow). Not secret. */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const snap = await getFirestore().collection('programs').get();
for (const d of snap.docs) {
  const p = d.data();
  console.log(
    `${d.id} avatarOn=${p.avatarOn ?? false} moodFaces=${JSON.stringify(p.avatarMoodFaces ?? {})} pronounFaces=${JSON.stringify(p.avatarFaces ?? {})}`,
  );
}
