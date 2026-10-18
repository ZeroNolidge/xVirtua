/**
 * Confirms the live app is sending valid App Check tokens before enforcement
 * is turned on. Reads appCheckStats/{day} (counted by the /warm route) for the
 * last 3 days. Exit 0 = confirmed; exit 2 = not yet. Used by the Deploy workflow.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const db = getFirestore();
const days = [0, 1, 2].map((n) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() - n * 86400000),
  ),
);
let valid = 0;
let invalid = 0;
let missing = 0;
for (const d of days) {
  const s = (await db.doc(`appCheckStats/${d}`).get()).data() ?? {};
  valid += Number(s.valid ?? 0);
  invalid += Number(s.invalid ?? 0);
  missing += Number(s.missing ?? 0);
}
const total = valid + invalid + missing;
console.log(
  `App Check tokens, last 3 days: ${valid} valid, ${invalid} invalid, ${missing} missing.`,
);
// Count only since the newest app version: old cached copies send no token.
const confirmed = valid >= 3 && valid / Math.max(1, valid + invalid) >= 0.95;
if (!confirmed) {
  console.log(
    total === 0
      ? 'No app opens recorded yet. Open the app (signed in) a few times, then deploy with enforce again.'
      : 'Not enough valid tokens yet to turn on enforcement safely.',
  );
  process.exit(2);
}
console.log('Confirmed: the app is sending valid App Check tokens.');
