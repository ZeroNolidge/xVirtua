# Where each mood's live face sits relative to its still, from a face check:
# frames when nothing else is on screen (no clip, not talking), compared on
# the patient only (segmentation mask), searching zoom and shift.
# Usage: python3 -I measure.py MODEL facecheck.json facecheck.webm manifest.json avatars_dir
import sys, json, cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
model, notes_p, vid_p, man_p, adir = sys.argv[1:6]
seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=model), output_confidence_masks=True))
notes = json.load(open(notes_p))['notes']; man = json.load(open(man_p))
# quiet spans per mood
mood = man['start']; spans = []; busy = False; t0 = None
for n in notes:
    t = n['t']; ty = n['type']
    if ty in ('says', 'fade-in', 'move'):
        if t0 is not None and not busy: spans.append((mood, t0, t))
        busy = True; t0 = None
    if ty == 'face-swap': mood = n['mood']
    if ty in ('said', 'fade-out', 'face-swap') or (ty == 'face-up'):
        busy = False; t0 = t + 0.8
cap = cv2.VideoCapture(vid_p); frames = {}
want = []
for m, a, b in spans:
    if b - a > 0.6: want += [(m, x) for x in np.linspace(a, b - 0.2, 3)]
i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    for m, x in want:
        if abs(t - x) < 0.02: frames.setdefault(m, []).append(cv2.resize(f, (768, 768)))
def person(img):
    bg = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))).confidence_masks[0].numpy_view()[..., 0]
    return (bg < 0.5).astype(np.float32)
G = lambda im: cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
for m, fl in frames.items():
    still = cv2.resize(cv2.imread(f"{adir}/{man['moods'][m]['poster']}"), (768, 768))
    ps = person(still); gs = G(still)
    res = []
    for f in fl:
        gf = G(f); pf = person(f)
        best = None
        for sc in np.arange(0.94, 1.0601, 0.005):
            Ts = np.float32([[sc, 0, (1 - sc) * 384], [0, sc, (1 - sc) * 384]])
            w = cv2.warpAffine(gs, Ts, (768, 768)); wm = cv2.warpAffine(ps, Ts, (768, 768))
            reg = (slice(60, 520), slice(200, 568))     # head and shoulders
            (sx, sy), resp = cv2.phaseCorrelate(w[reg] * wm[reg], gf[reg] * pf[reg])
            T2 = Ts.copy(); T2[:, 2] += (sx, sy)
            w2 = cv2.warpAffine(gs, T2, (768, 768)); m2 = cv2.warpAffine(ps, T2, (768, 768)) * pf
            cost = (np.abs(w2 - gf) * m2)[reg].sum() / max(1, m2[reg].sum())
            if best is None or cost < best[0]: best = (cost, sc, sx, sy)
        res.append(best)
    a = np.array([r[1:] for r in res])
    med = np.median(a, 0)
    print(m, len(fl), 'dx %.2f%% dy %.2f%% scale %.3f' % (med[1] / 7.68, med[2] / 7.68, med[0]), 'spread scale %.3f' % a[:, 0].std())
