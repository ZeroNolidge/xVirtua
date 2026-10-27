/**
 * Records a short sample of every GPT-Live voice (Record voices workflow) and
 * stores them at voiceSamples/{voice}.wav, where faculty play them in
 * Settings. Prints every event GPT-Live sends, to see what it does.
 *
 * Env: OPENAI_API_KEY, GOOGLE_CLOUD_PROJECT, STORAGE_BUCKET. Optional VOICES=a,b.
 */
import WebSocket from 'ws';
import { initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { LIVE_VOICES } from '@plainspeak/shared';

const LINE =
  "Hi, doc. Thanks for seeing me today. I'll be honest, I'm a little nervous about these blood pressure numbers.";
const RATE = 24_000;
const key = process.env.OPENAI_API_KEY ?? '';
if (!key) throw new Error('OPENAI_API_KEY missing');
initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  storageBucket: process.env.STORAGE_BUCKET,
});
const bucket = getStorage().bucket();
const voices = process.env.VOICES ? process.env.VOICES.split(',') : [...LIVE_VOICES];

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Tries ways of getting GPT-Live to speak first, in order, until one gives audio. */
const KICKS = ['commentary', 'commentary+silence', 'instructions'] as const;

function record(voice: string, kick: (typeof KICKS)[number]): Promise<Buffer> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const chunks: Buffer[] = [];
    const seen: Record<string, number> = {};
    let quiet: NodeJS.Timeout | null = null;
    let done = false;
    const finish = (why: string) => {
      if (done) return;
      done = true;
      clearTimeout(cap);
      if (quiet) clearTimeout(quiet);
      console.log(
        `  [${voice}/${kick}] ${why}; events ${JSON.stringify(seen)}; audio ${chunks.reduce((n, c) => n + c.length, 0)} bytes`,
      );
      try {
        ws.send(JSON.stringify({ type: 'session.close' }));
      } catch {
        /* closing */
      }
      setTimeout(() => ws.terminate(), 1500);
      resolve(Buffer.concat(chunks));
    };
    const cap = setTimeout(() => finish('timed out'), 25_000);
    ws.on('unexpected-response', (_q, res) => {
      let b = '';
      res.on('data', (c: Buffer) => (b += c.toString()));
      res.on('end', () => finish(`refused ${res.statusCode} ${b.slice(0, 300)}`));
    });
    ws.on('error', (e) => finish(`socket error ${e.message}`));
    ws.on('open', () => {
      const say = kick === 'instructions';
      ws.send(
        JSON.stringify({
          type: 'session.start',
          event_id: 'rec_start',
          session: {
            model: 'gpt-live-1',
            instructions: say
              ? `You are recording a short voice sample. As soon as the session starts, say exactly this, once, then stop: "${LINE}"`
              : 'You are recording a short voice sample. When you receive a line, say it exactly as written, once, then stop. Do not add anything.',
            audio: { format: { type: 'audio/pcm', rate: RATE }, output: { voice } },
            delegation: { type: 'client' },
          },
        }),
      );
    });
    ws.on('message', (data) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(ev.type);
      seen[type] = (seen[type] ?? 0) + 1;
      if (seen[type] === 1 && !type.endsWith('audio.delta'))
        console.log(`  [${voice}/${kick}] ${JSON.stringify(ev).slice(0, 300)}`);
      if (type === 'session.started') {
        if (kick !== 'instructions')
          ws.send(
            JSON.stringify({
              type: 'session.commentary.append',
              event_id: 'rec_line',
              delegation_id: null,
              content: LINE,
            }),
          );
        // Some voice models only speak once they hear something: send a moment of silence.
        if (kick === 'commentary+silence')
          ws.send(
            JSON.stringify({
              type: 'session.input_audio.append',
              audio: Buffer.alloc(RATE).toString('base64'),
            }),
          );
      } else if (type === 'session.output_audio.delta' && typeof ev.delta === 'string') {
        chunks.push(Buffer.from(ev.delta, 'base64'));
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => finish('done speaking'), 2000);
      } else if (type === 'error') {
        finish(`error ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
      }
    });
  });
}

let ok = 0;
for (const voice of voices) {
  console.log(`== ${voice}`);
  let pcm: Buffer = Buffer.alloc(0);
  for (const kick of KICKS) {
    pcm = await record(voice, kick);
    if (pcm.length > RATE) break; // more than half a second of audio
  }
  if (pcm.length <= RATE) {
    console.log(`  no usable audio for ${voice}`);
    continue;
  }
  await bucket.file(`voiceSamples/${voice}.wav`).save(wav(pcm), { contentType: 'audio/wav' });
  console.log(`  saved voiceSamples/${voice}.wav (${(pcm.length / (RATE * 2)).toFixed(1)}s)`);
  ok++;
}
console.log(`Recorded ${ok} of ${voices.length} voices.`);
if (!ok) process.exit(1);
