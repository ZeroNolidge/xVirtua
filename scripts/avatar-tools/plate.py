# Usage: python3 -I plate.py simli-frame.jpg ai-empty-room.jpg out.png
# Empty-room background: the original Simli frame everywhere except where the
# person is (taken from the AI-emptied room), so the visible room matches exactly.
import cv2, numpy as np, sys
orig = cv2.resize(cv2.imread(sys.argv[1]), (768, 768)).astype(np.float32)
room = cv2.resize(cv2.imread(sys.argv[2]), (768, 768)).astype(np.float32)
d = cv2.GaussianBlur(np.abs(orig - room).mean(2), (0, 0), 3)
m = (d > 18).astype(np.uint8)
m[400:] |= (d[400:] > 8).astype(np.uint8)  # clothes at the bottom edge can be close in colour
# keep the biggest blob (the person) and fill holes
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
m = (lab == big).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
m = np.zeros_like(m); cv2.drawContours(m, cnts, -1, 255, -1)
m = cv2.dilate(m, np.ones((25, 25), np.uint8))
w = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 8)[..., None]
out = orig * (1 - w) + room * w
cv2.imwrite(sys.argv[3], np.clip(out, 0, 255).astype(np.uint8))
cv2.imwrite(sys.argv[3].replace('.png', '-mask.png'), m)
print('person area %.0f%%' % (100 * (m > 0).mean()))
