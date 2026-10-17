/**
 * Creates a program and invites its first faculty member.
 *
 * Emulator:   npm run bootstrap -- --email you@example.org
 * Production: GOOGLE_CLOUD_PROJECT=<id> npm run bootstrap -- --email you@example.org --prod
 *
 * Re-running is safe: the program doc is merged and the invite is refreshed.
 */
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  DEFAULT_AUDIO_RETENTION_MONTHS,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_TIMEZONE,
  DEFAULT_TRANSCRIPT_RETENTION_MONTHS,
  RUBRIC_VERSION,
  type Program,
} from '@plainspeak/shared';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    program: { type: 'string', default: 'irmc' },
    name: { type: 'string', default: 'IRMC Rural Family Medicine Residency' },
    prod: { type: 'boolean', default: false },
  },
});

if (!values.email) {
  console.error('Usage: npm run bootstrap -- --email you@example.org [--program irmc] [--prod]');
  process.exit(1);
}

if (!values.prod) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
} else if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('--prod set but FIRESTORE_EMULATOR_HOST is too. Unset it first.');
  process.exit(1);
}

const projectId = values.prod ? process.env.GOOGLE_CLOUD_PROJECT : 'demo-plainspeak';
if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT for --prod.');
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();
const email = values.email.trim().toLowerCase();
const programId = values.program!;

const program: Program = {
  name: values.name!,
  timezone: DEFAULT_TIMEZONE,
  audioRetentionMonths: DEFAULT_AUDIO_RETENTION_MONTHS,
  transcriptRetentionMonths: DEFAULT_TRANSCRIPT_RETENTION_MONTHS,
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  patientModel: 'claude-opus-5-5',
  currentRubricVersion: RUBRIC_VERSION,
};

await db.doc(`programs/${programId}`).set(program, { merge: true });
await db.doc(`invites/${email}`).set({
  email,
  role: 'faculty',
  programId,
  invitedBy: 'bootstrap',
  status: 'pending',
  createdAt: FieldValue.serverTimestamp(),
});

console.log(`✔ Program "${programId}" ready on ${values.prod ? projectId : 'emulator'}.`);
console.log(`✔ Faculty invite for ${email}. Sign in at the app with that email.`);
