/**
 * Loads the 6 seed scenarios (as DRAFTS) and the jargon dictionary.
 *
 * Emulator:   npm run seed
 * Production: GOOGLE_CLOUD_PROJECT=<id> npx tsx scripts/seed-content.ts --prod
 *
 * Create-only by default: anything already in the database (e.g. scenarios a
 * faculty member has edited or published) is left alone. --force overwrites
 * seed content (scenario status is never changed by --force).
 */
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import { SEED_JARGON, type ScenarioDoc } from '@plainspeak/shared';
import { SEED_SCENARIOS } from '@plainspeak/shared/seed';

const { values } = parseArgs({
  options: {
    program: { type: 'string', default: 'irmc' },
    prod: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

if (!values.prod) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
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
const programId = values.program!;
const force = values.force!;

let batch: WriteBatch = db.batch();
let ops = 0;
async function queue(fn: (b: WriteBatch) => void) {
  fn(batch);
  if (++ops >= 400) {
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }
}

let created = 0;
let skipped = 0;
for (const s of SEED_SCENARIOS) {
  const ref = db.doc(`scenarios/${s.id}`);
  const existing = await ref.get();
  if (existing.exists && !force) {
    skipped++;
    continue;
  }
  if (existing.exists && existing.get('programId') !== programId) {
    console.error(`Scenario ${s.id} belongs to another program; skipping.`);
    continue;
  }
  const b = s.briefing;
  const summary: ScenarioDoc = {
    programId,
    status: existing.exists ? existing.get('status') : 'draft',
    currentVersion: '1',
    title: b.title,
    difficulty: b.difficulty,
    patientName: b.persona.name,
    patientAge: b.persona.age,
    reasonForVisit: b.reasonForVisit,
    tags: s.tags,
  };
  await queue((w) =>
    w.set(ref, { ...summary, seeded: true, updatedAt: FieldValue.serverTimestamp() }),
  );
  await queue((w) =>
    w.set(ref.collection('versions').doc('1'), { ...b, createdAt: FieldValue.serverTimestamp() }),
  );
  await queue((w) =>
    w.set(ref.collection('versions').doc('1').collection('private').doc('script'), s.script),
  );
  created++;
}

let terms = 0;
const existingTerms = new Set(
  (await db.collection('jargonTerms').select().get()).docs.map((d) => d.id),
);
for (const t of SEED_JARGON) {
  if (existingTerms.has(t.id) && !force) continue;
  await queue((w) => w.set(db.doc(`jargonTerms/${t.id}`), { ...t, programId: null, seeded: true }));
  terms++;
}
if (ops > 0) await batch.commit();

console.log(`✔ Scenarios: ${created} written (as drafts), ${skipped} already existed.`);
console.log(`✔ Jargon terms: ${terms} written (${SEED_JARGON.length} in the seed list).`);
