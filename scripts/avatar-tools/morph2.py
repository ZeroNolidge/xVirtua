# Like morph.py, but the room is lined up separately from the patient (for faces whose scene was re-drawn at a different zoom).
# Usage: python3 -I morph2.py start.png end.png Mface.npy Mbg.npy out.mp4  (Mface from align.py, Mbg from bgfit.py)
# Set FIX to the patient's touch-up (scripts/avatar-sources/<patient>.filter) so it
# matches the live face, like the clips: FIX=$(cat ...filter) python3 -I ...
import cv2, numpy as np, sys, subprocess, os
a,b=cv2.imread(sys.argv[1]),cv2.imread(sys.argv[2]); Mf=np.load(sys.argv[3]).copy(); Mb=np.load(sys.argv[4]).copy(); out=sys.argv[5]
size,fps=768,24; k=size/a.shape[1]
a=cv2.resize(a,(size,size),interpolation=cv2.INTER_AREA); b=cv2.resize(b,(size,size),interpolation=cv2.INTER_AREA)
Mf[:,2]*=k
inv=lambda M: np.linalg.inv(np.vstack([M,[0,0,1]]))[:2]
I=np.float32([[1,0,0],[0,1,0]]); n=48
# person mask in the START framing: head ellipse + torso; soft edge
m=np.zeros((size,size),np.float32)
cv2.ellipse(m,(384,290),(150,200),0,0,360,1,-1)
cv2.ellipse(m,(384,800),(400,330),0,0,360,1,-1)
hard=m.copy()
m=cv2.GaussianBlur(m,(0,0),18)[...,None]
# The room alone: paint over the patient (plain wall behind her) for the room layer.
def room(img,mask):
    big=cv2.dilate((mask>0).astype(np.uint8)*255,np.ones((41,41),np.uint8))
    sm=cv2.resize(img,(192,192)); bm=cv2.resize(big,(192,192))
    f=cv2.resize(cv2.inpaint(sm,bm,9,cv2.INPAINT_TELEA),(size,size),interpolation=cv2.INTER_CUBIC)
    w=cv2.GaussianBlur(big.astype(np.float32)/255,(0,0),6)[...,None]
    return (img*(1-w)+f*w).astype(np.uint8)
ra=room(a,hard); rb=room(b,cv2.warpAffine(hard,inv(Mf).astype(np.float32),(size,size)))
p=subprocess.Popen(['ffmpeg','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{size}x{size}','-r',str(fps),'-i','-',*(['-vf', os.environ['FIX'] + ',format=yuv420p'] if os.environ.get('FIX') else []), '-c:v','libx264','-preset','slow','-crf','20','-pix_fmt','yuv420p','-an','-movflags','+faststart',out],stdin=subprocess.PIPE)
def frame(M,s,a=a,b=b):
    Mi=inv(M)
    fa=cv2.warpAffine(a,(I*(1-s)+Mi*s).astype(np.float32),(size,size),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    fb=cv2.warpAffine(b,(M*(1-s)+I*s).astype(np.float32),(size,size),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    return cv2.addWeighted(fa,1-s,fb,s,0).astype(np.float32)
for i in range(n):
    t=i/(n-1); s=t*t*(3-2*t)
    # mask moves from start framing to end framing along with the person
    mm=cv2.warpAffine(m,(I*(1-s)+inv(Mf)*s).astype(np.float32),(size,size),borderMode=cv2.BORDER_REPLICATE)[...,None]
    o=mm*frame(Mf,s)+(1-mm)*frame(Mb,s,ra,rb)
    # Start and end exactly on the live faces.
    e0=max(0.0,1-t/0.12); e1=max(0.0,(t-0.88)/0.12)
    o=o*(1-e0-e1)+a.astype(np.float32)*e0+b.astype(np.float32)*e1
    p.stdin.write(np.clip(o,0,255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait()
