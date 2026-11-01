# Usage: python3 -I bgfit.py start.png end.png Mbg.npy  (lines up the ROOM of end.png with start.png, ignoring the patient)
# For morph2.py, when Simli re-drew a face's room at a different zoom.
import cv2, numpy as np, sys
a=cv2.resize(cv2.imread(sys.argv[1]),(768,768)); b=cv2.resize(cv2.imread(sys.argv[2]),(768,768))
m=np.zeros((768,768),np.uint8); m[:,:200]=255; m[:120,:]=255; m[:,600:]=255
m[60:768,200:600]=0
s=cv2.SIFT_create(4000)
ka,da=s.detectAndCompute(cv2.cvtColor(a,cv2.COLOR_BGR2GRAY),m); kb,db=s.detectAndCompute(cv2.cvtColor(b,cv2.COLOR_BGR2GRAY),m)
mt=[x for x,y in cv2.BFMatcher().knnMatch(db,da,k=2) if x.distance<0.75*y.distance]
src=np.float32([kb[x.queryIdx].pt for x in mt]); dst=np.float32([ka[x.trainIdx].pt for x in mt])
M,inl=cv2.estimateAffinePartial2D(src,dst,ransacReprojThreshold=3)
print('bg matches',len(mt),'inliers',int(inl.sum()),'scale %.3f'%np.hypot(M[0,0],M[1,0]),'t',M[:,2].round(1))
np.save(sys.argv[3],M)
