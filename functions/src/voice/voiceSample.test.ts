import { describe, expect, it } from 'vitest';
import { voicePreview } from './voiceSample.js';

const faculty = { uid: 'f', claims: { role: 'faculty', programId: 'irmc' } } as never;
const resident = { uid: 'r', claims: { role: 'resident', programId: 'irmc' } } as never;
const db = {
  doc: () => ({}),
  runTransaction: async () => undefined,
} as never;

describe('voice preview', () => {
  it('is faculty only and checks the voice', async () => {
    const f = (async () =>
      new Response('{"transport":{"sdp":"v=0 ok"}}')) as unknown as typeof fetch;
    await expect(
      voicePreview(db, resident, { voice: 'cinder', sdp: 'v=0 offer..' }, 'sk', f),
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(
      voicePreview(db, faculty, { voice: 'alloy', sdp: 'v=0 offer..' }, 'sk', f),
    ).rejects.toBeTruthy();
  });
});
