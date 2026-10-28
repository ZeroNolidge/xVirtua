/* global AudioWorkletProcessor, registerProcessor */
// Turns the patient's voice into 16-bit PCM chunks (16 kHz, the context's
// rate) for the video avatar. Served from our own site so the page's
// Content-Security-Policy allows it.
class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(1600); // 100 ms
    this.i = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let k = 0; k < ch.length; k++) {
        this.buf[this.i++] = Math.max(-32768, Math.min(32767, Math.round(ch[k] * 32767)));
        if (this.i === this.buf.length) {
          this.port.postMessage(this.buf.slice().buffer, []);
          this.i = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16', Pcm16);
