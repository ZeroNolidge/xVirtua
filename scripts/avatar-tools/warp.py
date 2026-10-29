# Adds the zoom/shift from align.py smoothly across a mood-change clip, so it
# starts on the first Simli face and ends exactly on the second.
# Usage: python3 -I warp.py clip.mp4 Mface.npy out.mp4  (needs opencv-python-headless, ffmpeg)
import cv2, numpy as np, sys, subprocess
src, Mpath, out = sys.argv[1:4]
M = np.load(Mpath)                       # at-ease -> guarded framing (1024 px)
A = np.vstack([M, [0, 0, 1]]); Minv = np.linalg.inv(A)[:2]
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
h, w = frames[0].shape[:2]; k = w / 1024
Minv = Minv.copy(); Minv[:, 2] *= k
I = np.float32([[1, 0, 0], [0, 1, 0]]); n = len(frames)
p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}', '-r', str(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
for i, f in enumerate(frames):
    t = i / (n - 1); s = t * t * (3 - 2 * t)
    T = (I * (1 - s) + Minv * s).astype(np.float32)
    p.stdin.write(cv2.warpAffine(f, T, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE).tobytes())
p.stdin.close(); p.wait()
