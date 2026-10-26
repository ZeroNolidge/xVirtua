import { describe, expect, it } from 'vitest';
import { pcmToWav, voiceSample } from './voiceSample.js';

const faculty = { uid: 'f', claims: { role: 'faculty', programId: 'irmc' } } as never;
const resident = { uid: 'r', claims: { role: 'resident', programId: 'irmc' } } as never;

describe('voice samples', () => {
  it('builds a valid WAV header', () => {
    const wav = pcmToWav(Buffer.alloc(4800));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(44 + 4800);
  });

  it('is faculty only, makes each voice once, then serves it from storage', async () => {
    const saved = new Map<string, Buffer>();
    const store = {
      get: async (v: string) => saved.get(v) ?? null,
      put: async (v: string, w: Buffer) => void saved.set(v, w),
    };
    let recorded = 0;
    const record = async () => {
      recorded++;
      return Buffer.alloc(48000);
    };
    await expect(
      voiceSample(resident, { voice: 'cinder' }, 'sk', store, record),
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(
      voiceSample(faculty, { voice: 'alloy' }, 'sk', store, record),
    ).rejects.toBeTruthy();
    const a = await voiceSample(faculty, { voice: 'cinder' }, 'sk', store, record);
    const b = await voiceSample(faculty, { voice: 'cinder' }, 'sk', store, record);
    expect(recorded).toBe(1);
    expect(a.wav).toBe(b.wav);
    expect(Buffer.from(a.wav, 'base64').subarray(0, 4).toString()).toBe('RIFF');
  });
});
