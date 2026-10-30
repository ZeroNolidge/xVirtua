import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes, uploadString } from 'firebase/storage';
import { actors, makeEnv } from './setup';

let env: RulesTestEnvironment;
let a: ReturnType<typeof actors>;
const audio = new Uint8Array([1, 2, 3, 4]);
const meta = { contentType: 'audio/webm' };
const pathA = 'audio/irmc/resA/sA/recording.webm';

beforeAll(async () => {
  env = await makeEnv();
  a = actors(env);
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'sessions/sA'), { uid: 'resA', programId: 'irmc' });
    await setDoc(doc(ctx.firestore(), 'sessions/sB'), { uid: 'resB', programId: 'irmc' });
  });
});
afterAll(async () => {
  await env?.cleanup();
});

async function seedAudio() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), pathA), audio, meta);
  });
}

describe('audio uploads', () => {
  it('owner can upload a webm recording for their own session', async () => {
    await assertSucceeds(uploadBytes(ref(a.resA.storage(), pathA), audio, meta));
  });

  it('owner can upload an iOS m4a recording', async () => {
    await assertSucceeds(
      uploadBytes(ref(a.resA.storage(), 'audio/irmc/resA/sA/recording.m4a'), audio, {
        contentType: 'audio/mp4',
      }),
    );
  });

  it('rejects uploads to someone else’s path or session', async () => {
    await assertFails(uploadBytes(ref(a.resB.storage(), pathA), audio, meta));
    await assertFails(
      uploadBytes(ref(a.resA.storage(), 'audio/irmc/resB/sB/recording.webm'), audio, meta),
    );
    await assertFails(
      uploadBytes(ref(a.resA.storage(), 'audio/other/resA/sA/recording.webm'), audio, meta),
    );
    await assertFails(uploadBytes(ref(a.facultyIrmc.storage(), pathA), audio, meta));
    await assertFails(
      uploadBytes(ref(a.resA.storage(), 'audio/irmc/resA/bad.id/recording.webm'), audio, meta),
    );
  });

  // Uploading into your own folder under a session ID you don't own is allowed
  // by rules, but endSession only links audio for the caller's own session,
  // and the nightly retention job deletes unlinked uploads (see
  // functions/src/retention/retention.integration.test.ts).

  it('rejects wrong type, wrong name, and unauthenticated uploads', async () => {
    await assertFails(
      uploadString(ref(a.resA.storage(), pathA), 'x', 'raw', { contentType: 'text/plain' }),
    );
    await assertFails(
      uploadBytes(ref(a.resA.storage(), 'audio/irmc/resA/sA/evil.exe'), audio, meta),
    );
    await assertFails(uploadBytes(ref(a.anon.storage(), pathA), audio, meta));
    await assertFails(uploadBytes(ref(a.noClaims.storage(), pathA), audio, meta));
  });

  it('rejects overwriting an existing recording', async () => {
    await seedAudio();
    await assertFails(uploadBytes(ref(a.resA.storage(), pathA), audio, meta));
  });
});

describe('audio reads and deletes', () => {
  it('owner and same-program faculty can read', async () => {
    await seedAudio();
    await assertSucceeds(getBytes(ref(a.resA.storage(), pathA)));
    await assertSucceeds(getBytes(ref(a.facultyIrmc.storage(), pathA)));
  });

  it('other residents, other programs and strangers cannot read', async () => {
    await seedAudio();
    for (const ctx of [a.resB, a.facultyOther, a.anon, a.noClaims]) {
      await assertFails(getBytes(ref(ctx.storage(), pathA)));
    }
  });

  it('nobody deletes from the client', async () => {
    await seedAudio();
    await assertFails(deleteObject(ref(a.resA.storage(), pathA)));
    await assertFails(deleteObject(ref(a.facultyIrmc.storage(), pathA)));
  });
});

describe('face check uploads', () => {
  const video = { contentType: 'video/webm' };
  it('faculty can upload a face-check recording and its notes into their own folder', async () => {
    await assertSucceeds(
      uploadBytes(ref(a.facultyIrmc.storage(), 'faceChecks/irmc/facIrmc/fc1.webm'), audio, video),
    );
    await assertSucceeds(
      uploadString(ref(a.facultyIrmc.storage(), 'faceChecks/irmc/facIrmc/fc1.json'), '{}', 'raw', {
        contentType: 'application/json',
      }),
    );
  });

  it('residents and other folders are refused', async () => {
    await assertFails(
      uploadBytes(ref(a.resA.storage(), 'faceChecks/irmc/resA/fc1.webm'), audio, video),
    );
    await assertFails(
      uploadBytes(
        ref(a.facultyIrmc.storage(), 'faceChecks/irmc/someoneElse/fc1.webm'),
        audio,
        video,
      ),
    );
    await assertFails(
      uploadBytes(ref(a.facultyIrmc.storage(), 'faceChecks/irmc/facIrmc/fc1.exe'), audio, video),
    );
  });
});
