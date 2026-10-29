# Adds the zoom/shift from align.py smoothly across a mood-change clip, so it
# starts on the first Simli face and ends on the second.
# Usage: python3 -I warp.py clip.mp4 Mface.npy out.mp4 [end-face.jpg [blend-seconds]]
# With end-face.jpg, the last blend-seconds (default 1) also fade into that
# image, which hides small differences in the body or background.
# Needs opencv-python-headless and ffmpeg.
import cv2, numpy as np, sys, subprocess
src, Mpath, out = sys.argv[1:4]
end = cv2.imread(sys.argv[4]) if len(sys.argv) > 4 else None
blend = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
M = np.load(Mpath)                       # end face -> start face framing (1024 px)
Minv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
h, w = frames[0].shape[:2]
Minv = Minv.copy(); Minv[:, 2] *= w / 1024
if end is not None: end = cv2.resize(end, (w, h), interpolation=cv2.INTER_AREA)
I = np.float32([[1, 0, 0], [0, 1, 0]]); n = len(frames); nb = max(1, round(blend * fps))
p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}', '-r', str(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
for i, f in enumerate(frames):
    t = i / (n - 1); s = t * t * (3 - 2 * t)
    T = (I * (1 - s) + Minv * s).astype(np.float32)
    f = cv2.warpAffine(f, T, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if end is not None and i >= n - nb:
        a = (i - (n - nb) + 1) / nb; a = a * a * (3 - 2 * a)
        f = cv2.addWeighted(f, 1 - a, end, a, 0)
    p.stdin.write(f.tobytes())
p.stdin.close(); p.wait()
