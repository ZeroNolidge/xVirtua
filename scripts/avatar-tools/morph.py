# Makes a mood-change clip without AI: a smooth blend from one Simli face to
# the other, keeping the faces lined up, so the expression changes and the
# mouth stays closed.
# Usage: python3 -I morph.py start.png end.png Mface.npy out.mp4 [seconds]
# (Mface.npy from align.py start.png end.png.) Needs opencv-python-headless, ffmpeg.
import cv2, numpy as np, sys, subprocess
a, b = cv2.imread(sys.argv[1]), cv2.imread(sys.argv[2])
M = np.load(sys.argv[3]); out = sys.argv[4]
secs = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
size, fps = 768, 24
k = size / a.shape[1]
a = cv2.resize(a, (size, size), interpolation=cv2.INTER_AREA)
b = cv2.resize(b, (size, size), interpolation=cv2.INTER_AREA)
M = M.copy(); M[:, 2] *= k                          # end face -> start framing
Minv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]  # start face -> end framing
I = np.float32([[1, 0, 0], [0, 1, 0]]); n = round(secs * fps)
p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{size}x{size}', '-r', str(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
for i in range(n):
    t = i / (n - 1); s = t * t * (3 - 2 * t)
    fa = cv2.warpAffine(a, (I * (1 - s) + Minv * s).astype(np.float32), (size, size), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    fb = cv2.warpAffine(b, (M * (1 - s) + I * s).astype(np.float32), (size, size), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    p.stdin.write(cv2.addWeighted(fa, 1 - s, fb, s, 0).tobytes())
p.stdin.close(); p.wait()
