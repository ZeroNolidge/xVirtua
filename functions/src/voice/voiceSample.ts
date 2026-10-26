import { HttpsError } from 'firebase-functions/v2/https';
import WebSocket from 'ws';
import { z } from 'zod';
import { LIVE_VOICES } from '@plainspeak/shared';
import { parse, type Caller } from '../lib/callable.js';
import { LIVE_MODEL } from './live.js';

/**
 * Faculty tool: a few seconds of each GPT-Live voice, so they can pick voices
 * that fit each patient. The server opens a short GPT-Live session over
 * WebSocket, has it say one line, and returns the audio as WAV. Each voice is
 * made once and then served from storage.
 */
export const SAMPLE_LINE =
  "Hi, doc. Thanks for seeing me today. I'll be honest, I'm a little nervous about these blood pressure numbers.";
const LIVE_WS_URL = 'wss://api.openai.com/v1/live/sessions';
const RATE = 24_000;

const input = z.object({ voice: z.enum(LIVE_VOICES) });

export interface SampleStore {
  get(voice: string): Promise<Buffer | null>;
  put(voice: string, wav: Buffer): Promise<void>;
}

/** 16-bit mono PCM → WAV file. */
export function pcmToWav(pcm: Buffer, rate = RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Has GPT-Live say the sample line in `voice`; returns raw 24 kHz PCM. */
export function recordSample(apiKey: string, voice: string, timeoutMs = 20_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(LIVE_WS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    const chunks: Buffer[] = [];
    let quietTimer: NodeJS.Timeout | null = null;
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardStop);
      if (quietTimer) clearTimeout(quietTimer);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'session.close' }));
      } catch {
        /* closing anyway */
      }
      setTimeout(() => ws.terminate(), 500);
      if (err && !chunks.length) reject(err);
      else resolve(Buffer.concat(chunks));
    };
    const hardStop = setTimeout(() => finish(new Error('Voice sample timed out')), timeoutMs);
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () =>
        finish(new Error(`GPT-Live refused: ${res.statusCode} ${body.slice(0, 300)}`)),
      );
    });
    ws.on('error', (e) => finish(e));
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'session.start',
          event_id: 'sample_start',
          session: {
            model: LIVE_MODEL,
            instructions:
              'You are recording a short voice sample. When you receive a line, say it exactly as written, once, then stop. Do not add anything.',
            audio: { format: { type: 'audio/pcm', rate: RATE }, output: { voice } },
            delegation: { type: 'client' },
          },
        }),
      );
    });
    ws.on('message', (data) => {
      let ev: { type?: string; delta?: string; error?: { message?: string } };
      try {
        ev = JSON.parse(data.toString()) as typeof ev;
      } catch {
        return;
      }
      if (ev.type === 'session.started') {
        ws.send(
          JSON.stringify({
            type: 'session.commentary.append',
            event_id: 'sample_line',
            delegation_id: null,
            content: SAMPLE_LINE,
          }),
        );
      } else if (ev.type === 'session.output_audio.delta' && ev.delta) {
        chunks.push(Buffer.from(ev.delta, 'base64'));
        // Done once the audio has stopped for a moment.
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(), 1500);
      } else if (ev.type === 'error') {
        finish(new Error(ev.error?.message ?? 'GPT-Live error'));
      }
    });
  });
}

/** Returns a WAV sample of `voice` (made once, then cached). Faculty only. */
export async function voiceSample(
  caller: Caller | null,
  data: unknown,
  apiKey: string,
  store: SampleStore,
  record: typeof recordSample = recordSample,
) {
  if (!caller) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (caller.claims.role !== 'faculty') throw new HttpsError('permission-denied', 'Faculty only.');
  const { voice } = parse(input, data);
  let wav = await store.get(voice);
  if (!wav) {
    if (!apiKey) throw new HttpsError('unavailable', 'Live voice isn’t set up.');
    const pcm = await record(apiKey, voice).catch((e: unknown) => {
      console.error('voice sample failed', voice, e instanceof Error ? e.message : e);
      throw new HttpsError('unavailable', 'Couldn’t make a sample of that voice right now.', {
        detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
    });
    if (pcm.length < RATE) throw new HttpsError('unavailable', 'GPT-Live sent no audio.');
    wav = pcmToWav(pcm);
    await store.put(voice, wav).catch(() => undefined);
  }
  return { voice, wav: wav.toString('base64') };
}
