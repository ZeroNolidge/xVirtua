import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadString, getBytes } from 'firebase/storage';
import { makeEnv } from './setup';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => {
  await env?.cleanup();
});

describe('Phase 0: default deny', () => {
  it('blocks unauthenticated Firestore reads and writes', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users/someone')));
    await assertFails(setDoc(doc(db, 'users/someone'), { role: 'faculty' }));
  });

  it('blocks a signed-in resident from writing server-owned data', async () => {
    const db = env
      .authenticatedContext('res1', { role: 'resident', programId: 'irmc' })
      .firestore();
    await assertFails(setDoc(doc(db, 'sessions/s1/scores/v1'), { overall: 100 }));
    await assertFails(setDoc(doc(db, 'userProgress/res1'), { xp: 999999 }));
  });

  it('blocks Storage access', async () => {
    const storage = env
      .authenticatedContext('res1', { role: 'resident', programId: 'irmc' })
      .storage();
    await assertFails(uploadString(ref(storage, 'audio/irmc/res1/s1.webm'), 'x'));
    await assertFails(getBytes(ref(storage, 'audio/irmc/res1/s1.webm')));
  });
});
