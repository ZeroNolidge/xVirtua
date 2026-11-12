/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Turns the patient's voice into 16-bit PCM chunks at 16 kHz for the video
// avatar (Simli takes 16 kHz only). Served from our own site so the page's
// Content-Security-Policy allows it.
//
// Chunks are about 190 ms (6000 bytes): Simli's preferred size; smaller ones
// popped. Each chunk carries its peak level, so the sender can skip silence.
// If the browser wouldn't give us a 16 kHz context, the sound is resampled
// here (linear interpolation: fine for speech) instead of being sent at the
// wrong rate.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 3000; // 187.5 ms at 16 kHz = 6000 bytes

class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(CHUNK_SAMPLES);
    this.i = 0;
    this.peak = 0;
    this.ratio = sampleRate / TARGET_RATE;
    this.pos = 0; // fractional read position into the current block
    this.last = 0; // the previous block's last sample (for interpolation)
  }

  push(v) {
    const s = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    this.buf[this.i++] = s;
    const a = Math.abs(s);
    if (a > this.peak) this.peak = a;
    if (this.i === this.buf.length) {
      this.port.postMessage({ pcm: this.buf.slice().buffer, peak: this.peak }, []);
      this.i = 0;
      this.peak = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    if (this.ratio === 1) {
      for (let k = 0; k < ch.length; k++) this.push(ch[k]);
      return true;
    }
    const n = ch.length;
    let t = this.pos;
    for (; t < n; t += this.ratio) {
      const k = Math.floor(t);
      const frac = t - k;
      const s0 = k - 1 >= 0 ? ch[k - 1] : this.last;
      const s1 = ch[k];
      // Interpolate between the sample before t and the one at t.
      this.push(s0 + (s1 - s0) * frac);
    }
    this.pos = t - n;
    this.last = ch[n - 1];
    return true;
  }
}
registerProcessor('pcm16', Pcm16);
