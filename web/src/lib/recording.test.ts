import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', () => ({ storage: {} }));
const end = vi.fn(async () => ({ data: {} }));
vi.mock('./session', () => ({ sessionApi: { end: (x: unknown) => end(x) } }));
let behave: 'ok' | 'stall' = 'ok';
const cancel = vi.fn();
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytesResumable: () => ({
    cancel,
    on: (_e: string, progress: () => void, _err: (e: Error) => void, done: () => void) => {
      progress();
      if (behave === 'ok') setTimeout(done, 5);
      // 'stall': never finishes (the connection dropped)
    },
  }),
}));

const { uploadRecording } = await import('./recording');
const job = { sessionId: 's1', programId: 'irmc', uid: 'u1', blob: new Blob(['a']), ext: 'webm' };

describe('uploadRecording', () => {
  it('uploads and attaches the recording to the session', async () => {
    behave = 'ok';
    await uploadRecording(job);
    expect(end).toHaveBeenCalledWith({ sessionId: 's1', audioExt: 'webm' });
  });

  it('gives up quickly when the upload stalls, so the app can offer Try again', async () => {
    behave = 'stall';
    end.mockClear();
    await expect(uploadRecording(job, 50)).rejects.toThrow('Upload stalled');
    expect(cancel).toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });
});
