import { describe, expect, it } from 'vitest';
import { voiceSample } from './voiceSample.js';

const faculty = { uid: 'f', claims: { role: 'faculty', programId: 'irmc' } } as never;
const resident = { uid: 'r', claims: { role: 'resident', programId: 'irmc' } } as never;

describe('voice samples', () => {
  it('serves recorded samples to faculty only', async () => {
    const read = async (v: string) => (v === 'cinder' ? Buffer.from('RIFF....') : null);
    await expect(voiceSample(resident, { voice: 'cinder' }, read)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(voiceSample(faculty, { voice: 'alloy' }, read)).rejects.toBeTruthy();
    await expect(voiceSample(faculty, { voice: 'marin' }, read)).rejects.toMatchObject({
      code: 'not-found',
    });
    const r = await voiceSample(faculty, { voice: 'cinder' }, read);
    expect(Buffer.from(r.wav, 'base64').toString()).toBe('RIFF....');
  });
});
