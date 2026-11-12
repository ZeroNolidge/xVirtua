import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The worklet script runs in the browser's audio thread. Here it's loaded
 * with stand-ins for the globals it expects, so its chunking and resampling
 * can be checked.
 */
type Msg = { pcm: ArrayBuffer; peak: number };
let Processor: new () => { process(inputs: Float32Array[][]): boolean; port: { postMessage(m: Msg): void } };
const posted: Msg[] = [];

async function load(rate: number) {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = rate;
  g.AudioWorkletProcessor = class {
    port = { postMessage: (m: Msg) => posted.push(m) };
  };
  g.registerProcessor = (_name: string, cls: typeof Processor) => {
    Processor = cls;
  };
  // A fresh copy each time (the module is cached by URL).
  await import(/* @vite-ignore */ `../../public/pcm16-worklet.js?rate=${rate}`);
}

const tone = (n: number, amp: number) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((i / 16) * Math.PI));

describe('pcm16 worklet', () => {
  beforeAll(() => {
    posted.length = 0;
  });

  it('at 16 kHz: 3000-sample chunks (6000 bytes, about 190 ms) with their peak level', async () => {
    await load(16000);
    posted.length = 0;
    const p = new Processor();
    for (let k = 0; k < 24; k++) p.process([[tone(128, 0.5)]]); // 3072 samples
    expect(posted).toHaveLength(1);
    expect(posted[0]!.pcm.byteLength).toBe(6000);
    expect(posted[0]!.peak).toBeGreaterThan(16000);
    expect(posted[0]!.peak).toBeLessThanOrEqual(16384);
  });

  it('silence has a peak of 0', async () => {
    await load(16000);
    posted.length = 0;
    const p = new Processor();
    for (let k = 0; k < 24; k++) p.process([[new Float32Array(128)]]);
    expect(posted[0]!.peak).toBe(0);
  });

  it('at 48 kHz: resamples down, so a chunk still holds 190 ms of sound', async () => {
    await load(48000);
    posted.length = 0;
    const p = new Processor();
    // 9000 input samples at 48 kHz = 187.5 ms = one 3000-sample chunk at 16 kHz.
    for (let k = 0; k < 9000 / 128; k++) p.process([[tone(128, 0.5)]]);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.pcm.byteLength).toBe(6000);
    // Still a sine, not noise: the peak is the tone's.
    expect(posted[0]!.peak).toBeGreaterThan(15000);
  });
});
