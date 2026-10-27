import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { LIVE_VOICES } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';

/**
 * Faculty tool: a recorded sample of a GPT-Live voice, so they can pick
 * voices that fit each patient. The samples are recorded once by the
 * "Record voices" workflow (scripts/record-voices.ts) into storage.
 */
const input = z.object({ voice: z.enum(LIVE_VOICES) });

export type ReadSample = (voice: string) => Promise<Buffer | null>;

export async function voiceSample(caller: Caller | null, data: unknown, read: ReadSample) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (caller.claims.role !== 'faculty') throw new HttpsError('permission-denied', 'Faculty only.');
  const { voice } = parse(input, data);
  const wav = await read(voice);
  if (!wav) throw new HttpsError('not-found', 'That voice hasn’t been recorded yet.');
  return { voice, wav: wav.toString('base64') };
}
