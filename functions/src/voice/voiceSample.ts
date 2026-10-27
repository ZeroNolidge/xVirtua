import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { LIVE_VOICES } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { consumeQuota } from '../lib/quota.js';
import { openLiveCall } from './live.js';

/**
 * Faculty tool: hear a GPT-Live voice. The browser opens a short listen-only
 * GPT-Live call (the same kind of connection as a conversation) and has it
 * say the sample line, so faculty can pick voices that fit each patient.
 */
export const SAMPLE_LINE =
  "Hi, doc. Thanks for seeing me today. I'll be honest, I'm a little nervous about these blood pressure numbers.";

export const PREVIEW_INSTRUCTIONS =
  'You are recording a short voice sample. When you receive a line, say it exactly as written, once, in a natural, warm voice, then stop and stay silent. Do not add anything.';

const input = z.object({
  voice: z.enum(LIVE_VOICES),
  sdp: z.string().min(10).max(20_000),
});

export async function voicePreview(
  db: Firestore,
  caller: Caller | null,
  data: unknown,
  apiKey: string,
  doFetch: typeof fetch = fetch,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (caller.claims.role !== 'faculty') throw new HttpsError('permission-denied', 'Faculty only.');
  const { voice, sdp } = parse(input, data);
  if (!apiKey) throw new HttpsError('unavailable', 'Live voice isn’t set up.');
  await consumeQuota(db, caller.uid, 'liveCalls');
  const { answer } = await openLiveCall(apiKey, PREVIEW_INSTRUCTIONS, voice, sdp, doFetch);
  return { sdp: answer, line: SAMPLE_LINE };
}
