import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake Simli client: records what it was sent.
const sent: Uint8Array[] = [];
let cleared = 0;
let failStart = false;
const handlers: Record<string, (d?: string) => void> = {};
vi.mock('simli-client', () => ({
  LogLevel: { ERROR: 2 },
  SimliClient: class {
    on(ev: string, cb: (d?: string) => void) {
      handlers[ev] = cb;
    }
    async start() {
      if (failStart) throw 'ERROR: INVALID_FACE_ID';
    }
    async stop() {}
    sendAudioData(d: Uint8Array) {
      sent.push(d);
    }
    ClearBuffer() {
      cleared++;
    }
  },
}));

// Fake Web Audio: just enough to see what's connected to what.
const links: [string, string][] = [];
let worklet: { port: { onmessage: ((e: MessageEvent<ArrayBuffer>) => void) | null } };
class Node {
  constructor(readonly name: string) {}
  connect(to: Node) {
    links.push([this.name, to.name]);
    return to;
  }
  disconnect(to?: Node) {
    for (let i = links.length - 1; i >= 0; i--)
      if (links[i]![0] === this.name && (!to || links[i]![1] === to.name)) links.splice(i, 1);
  }
}
class FakeContext {
  state = 'running';
  destination = new Node('speakers');
  audioWorklet = { addModule: async () => undefined };
  async resume() {}
  async close() {}
  createGain() {
    return Object.assign(new Node('sink'), { gain: { value: 1 } });
  }
  createMediaElementSource() {
    return new Node('player');
  }
  createMediaStreamSource() {
    return new Node('track');
  }
}

beforeEach(() => {
  sent.length = 0;
  links.length = 0;
  cleared = 0;
  failStart = false;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal(
    'AudioWorkletNode',
    class extends Node {
      port = { onmessage: null };
      constructor() {
        super('pcm');
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        worklet = this;
      }
    },
  );
  vi.stubGlobal('MediaStream', class {});
});
afterEach(() => vi.unstubAllGlobals());

const { PatientAvatar } = await import('./avatar');
const els = () => ({
  video: document.createElement('video'),
  audio: document.createElement('audio'),
});

describe('video avatar', () => {
  it('sends only the patient’s player to Simli once the face is up, and goes quiet locally', async () => {
    const { video, audio } = els();
    const a = new PatientAvatar(video, audio);
    expect(await a.connect(async () => 'tok')).toBe(true);
    expect(a.ready).toBe(true);
    a.feedElement(document.createElement('audio'));
    expect(links).toContainEqual(['player', 'pcm']);
    expect(links).not.toContainEqual(['player', 'speakers']);
    worklet.port.onmessage!({ data: new Int16Array(1600).buffer } as MessageEvent<ArrayBuffer>);
    expect(sent).toHaveLength(1);
    // The resident cut in: Simli drops what it had queued.
    a.mute(true);
    expect(cleared).toBe(1);
    expect(audio.muted).toBe(true);
  });

  it('after a cut-in, his voice comes back at full volume (not stuck turned down)', async () => {
    const { video, audio } = els();
    const a = new PatientAvatar(video, audio);
    await a.connect(async () => 'tok');
    a.duck(true); // the resident started talking: turned down while we check
    a.mute(true); // it was the resident: cut him off
    a.mute(false); // his next line
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(1);
  });

  it('if Simli fails, the patient’s voice plays from our own player again', async () => {
    const a = new PatientAvatar(els().video, els().audio);
    await a.connect(async () => 'tok');
    a.feedElement(document.createElement('audio'));
    handlers.error!('CLOSING: session ended');
    expect(a.ready).toBe(false);
    expect(links).toContainEqual(['player', 'speakers']);
  });

  it('a refused session just means no face', async () => {
    failStart = true;
    const onFail = vi.fn();
    const a = new PatientAvatar(els().video, els().audio);
    a.onFail = onFail;
    expect(await a.connect(async () => 'tok')).toBe(false);
    expect(a.ready).toBe(false);
    expect(onFail).toHaveBeenCalled();
  });
});
