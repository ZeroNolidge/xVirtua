"""
bitHuman trial: how quickly a bitHuman avatar starts talking when a voice
streams in the way a live call does (40 ms pieces, in real time), whether it
keeps up, and what it looks like. Writes a video and a JSON report.

Usage: python latency_test.py AVATAR_FILE voice16k.wav OUT_DIR
Needs BITHUMAN_API_SECRET in the environment.
"""
import asyncio, json, os, subprocess, sys, time, wave

import numpy as np
from bithuman import AsyncBithuman

avatar_file, wav_path, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
CHUNK_MS = 40

w = wave.open(wav_path)
assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, 'need 16 kHz mono 16-bit'
pcm = w.readframes(w.getnframes())
voice_secs = w.getnframes() / 16000
step = 16000 * 2 * CHUNK_MS // 1000


async def main():
    t_create = time.perf_counter()
    avatar = await AsyncBithuman.create(model_path=avatar_file)
    ready_s = time.perf_counter() - t_create
    frames, audio = [], []
    first_voice = None
    t0 = None

    async def push():
        nonlocal t0
        await asyncio.sleep(1.0)  # a moment of idle first, like a live call
        t0 = time.perf_counter()
        for i in range(0, len(pcm), step):
            await avatar.push_audio(pcm[i:i + step], 16000, last_chunk=False)
            # Real time: the next piece arrives when it would on a call.
            target = t0 + (i + step) / (16000 * 2)
            await asyncio.sleep(max(0.0, target - time.perf_counter()))
        await avatar.flush()

    pusher = asyncio.create_task(push())
    started = time.perf_counter()
    async for frame in avatar.run():
        now = time.perf_counter()
        img = getattr(frame, 'bgr_image', None)
        if img is not None:
            frames.append((now, img))
        ch = getattr(frame, 'audio_chunk', None)
        if ch is not None:
            a = np.asarray(getattr(ch, 'array', ch))
            audio.append(a)
            if t0 is not None and first_voice is None and a.size and np.abs(a.astype(np.float32)).max() > 500:
                first_voice = now - t0
        if pusher.done() and t0 and now - t0 > voice_secs + 3:
            break
        if now - started > voice_secs + 30:
            break
    await avatar.shutdown()
    return ready_s, frames, audio, first_voice, t0


ready_s, frames, audio, first_voice, t0 = asyncio.run(main())
span = frames[-1][0] - frames[0][0] if len(frames) > 1 else 0
fps = (len(frames) - 1) / span if span else 0
# Video for review: the frames with the audio that came with them.
h, wd = frames[0][1].shape[:2]
raw = os.path.join(out, 'frames.raw')
with open(raw, 'wb') as f:
    for _, img in frames:
        f.write(np.ascontiguousarray(img).tobytes())
au = np.concatenate([a.reshape(-1) for a in audio]).astype(np.int16) if audio else np.zeros(1, np.int16)
wav_out = os.path.join(out, 'audio.wav')
with wave.open(wav_out, 'wb') as o:
    o.setnchannels(1); o.setsampwidth(2); o.setframerate(16000); o.writeframes(au.tobytes())
rate = round(fps) or 25
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{wd}x{h}', '-r', str(rate),
                '-i', raw, '-i', wav_out, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
                '-movflags', '+faststart', os.path.join(out, 'bithuman-ray.mp4')], check=True)
os.remove(raw)
report = {
    'avatar_ready_s': round(ready_s, 2),
    'voice_s': round(voice_secs, 2),
    'first_voiced_frame_after_s': round(first_voice, 3) if first_voice is not None else None,
    'frames': len(frames),
    'frames_per_s': round(fps, 1),
    'frame_size': [wd, h],
    'cpu_cores': os.cpu_count(),
}
json.dump(report, open(os.path.join(out, 'report.json'), 'w'), indent=2)
print(json.dumps(report, indent=2))
