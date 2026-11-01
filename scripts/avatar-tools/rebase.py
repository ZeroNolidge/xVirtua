# Puts a clip (or still) of one mood's Simli face onto the character's shared
# room (the Simli background every face shows): the patient is cut out of each
# frame (a person-segmentation model), moved to where that live face sits, and
# laid over the room. Then the clip matches the live picture as it is, wall
# included, and nothing in the room doubles up when a clip plays.
# Usage: python3 -I rebase.py MODEL room.png in.(mp4|jpg) out.(mp4|jpg) dx% dy% scale
#   MODEL: selfie_multiclass_256x256.tflite (MediaPipe image segmenter)
#   room: the shared room image as uploaded to Simli
#   dx%, dy%, scale: where the live face sits relative to this face's still
#   (the face check's head samples for that mood)
import sys, subprocess
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
model, room_p, src, out = sys.argv[1:5]
dx, dy, sc = float(sys.argv[5]) / 100, float(sys.argv[6]) / 100, float(sys.argv[7])
N = 768
seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
    base_options=BaseOptions(model_asset_path=model), output_confidence_masks=True))
room = cv2.resize(cv2.imread(room_p), (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)
T = np.float32([[sc, 0, (1 - sc) * N / 2 + dx * N], [0, sc, (1 - sc) * N / 2 + dy * N]])
prev = None
def frame(f):
    global prev
    rgb = np.ascontiguousarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    bg = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)).confidence_masks[0].numpy_view()[..., 0]
    a = np.clip((0.75 - bg) / 0.5, 0, 1).astype(np.float32)   # the patient, with a soft edge
    a = cv2.erode(a, np.ones((3, 3), np.uint8))                 # no fringe of the old room
    a = cv2.GaussianBlur(a, (0, 0), 1.2)
    if prev is not None: a = 0.6 * a + 0.4 * prev              # steady edges from frame to frame
    prev = a
    fw = cv2.warpAffine(f.astype(np.float32), T, (N, N), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    aw = cv2.warpAffine(a, T, (N, N))[..., None]
    return np.clip(fw * aw + room * (1 - aw), 0, 255).astype(np.uint8)
if src.endswith(('.jpg', '.png')):
    cv2.imwrite(out, frame(cv2.resize(cv2.imread(src), (N, N))), [cv2.IMWRITE_JPEG_QUALITY, 92])
    sys.exit()
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24
p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{N}x{N}', '-r', str(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
while True:
    ok, f = cap.read()
    if not ok: break
    p.stdin.write(frame(cv2.resize(f, (N, N))).tobytes())
p.stdin.close(); p.wait()
