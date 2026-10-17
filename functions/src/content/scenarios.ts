import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { ScenarioStatus } from '@plainspeak/shared';
import { parse, requireFaculty, type Caller } from '../lib/callable.js';

const input = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  status: z.enum(['draft', 'active', 'archived']),
});

/** Faculty publish (active), unpublish (draft) or archive a scenario in their program. */
export async function setScenarioStatus(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
): Promise<{ scenarioId: string; status: ScenarioStatus }> {
  const fac = requireFaculty(caller);
  const { scenarioId, status } = parse(input, data);
  const ref = db.doc(`scenarios/${scenarioId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('programId') !== fac.programId) {
    throw new HttpsError('not-found', 'Scenario not found.');
  }
  await ref.update({
    status,
    statusChangedBy: fac.uid,
    statusChangedAt: FieldValue.serverTimestamp(),
  });
  return { scenarioId, status };
}
