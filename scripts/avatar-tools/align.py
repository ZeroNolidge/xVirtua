# Lines up one Simli face image with another (same person, different mood).
# Usage: python3 -I align.py guarded.png at-ease.png out-dir
# Writes out-dir/at-ease-on-guarded-framing.png (use it as the end frame of the
# mood-change clip) and out-dir/Mface.npy (the zoom/shift, for warp.py).
import cv2, numpy as np, sys
g = cv2.imread(sys.argv[1]); a = cv2.imread(sys.argv[2]); out = sys.argv[3]
h, w = g.shape[:2]
mask = np.zeros((h, w), np.uint8); cv2.rectangle(mask, (int(w*.28), int(h*.08)), (int(w*.72), int(h*.75)), 255, -1)
sift = cv2.SIFT_create(4000)
kg, dg = sift.detectAndCompute(cv2.cvtColor(g, cv2.COLOR_BGR2GRAY), mask)
ka, da = sift.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), mask)
m = cv2.BFMatcher().knnMatch(da, dg, k=2)
good = [x for x, y in m if x.distance < 0.75 * y.distance]
src = np.float32([ka[x.queryIdx].pt for x in good]); dst = np.float32([kg[x.trainIdx].pt for x in good])
M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4)
s = np.hypot(M[0,0], M[1,0]); r = np.degrees(np.arctan2(M[1,0], M[0,0]))
print('matches', len(good), 'inliers', int(inl.sum()), 'scale %.4f rot %.2f tx %.1f ty %.1f' % (s, r, M[0,2], M[1,2]))
np.save(out + '/Mface.npy', M)
wa = cv2.warpAffine(a, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
cv2.imwrite(out + '/at-ease-on-guarded-framing.png', wa)
cv2.imwrite(out + '/compare2.jpg', cv2.resize(np.hstack([g, wa, cv2.addWeighted(g, .5, wa, .5, 0)]), (1500, 500)))
