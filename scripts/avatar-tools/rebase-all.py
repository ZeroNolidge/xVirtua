# Rebuilds a patient's stills, clips and mood-change blends on their shared
# room (scripts/avatar-sources/<patient>.room.json): see rebase.py.
# Usage: python3 rebase-all.py PATIENT MODEL [FIX]   (run from the repo root)
import json, os, subprocess, sys, tempfile
patient, model = sys.argv[1], sys.argv[2]
fix = sys.argv[3] if len(sys.argv) > 3 else ''
cfg = json.load(open(f'scripts/avatar-sources/{patient}.room.json'))
out = f'web/public/avatars/{patient}'
man = json.load(open(f'{out}/manifest.json'))
room = f"scripts/avatar-sources/{cfg['room']}"
tools = 'scripts/avatar-tools'
blends = set((man.get('transitions') or {}).values())
tmp = tempfile.mkdtemp()
def run(*a): subprocess.run([sys.executable, *a], check=True)
for mood, m in cfg['moods'].items():
    dx, dy, sc = (str(v) for v in m['at'])
    for name in sorted(os.listdir(out)):
        if name in blends or not name.endswith(('.jpg', '.mp4')): continue
        stem = name.rsplit('.', 1)[0]
        if not any(stem == p or stem.startswith(p + '-') for p in m['files']): continue
        src = f'{out}/{name}'
        if name.endswith('.jpg') and fix:
            # The still gets the clips' touch-up too, so blends from it match them.
            t = f'{tmp}/{name}'
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf', fix, '-q:v', '2', t], check=True)
            src = t
        dst = f'{tmp}/out-{name}'
        run(f'{tools}/rebase.py', model, room, src, dst, dx, dy, sc)
        os.replace(dst, f'{out}/{name}')
        print('rebased', name, flush=True)
# Mood-change blends, from the rebuilt stills (same room, so only the patient changes).
for key, file in (man.get('transitions') or {}).items():
    a, b = key.split('>')
    pa, pb = (f"{out}/{man['moods'][x]['poster']}" for x in (a, b))
    d = f'{tmp}/al-{a}-{b}'; os.makedirs(d, exist_ok=True)
    run(f'{tools}/align.py', pa, pb, d)
    run(f'{tools}/morph.py', pa, pb, f'{d}/Mface.npy', f'{tmp}/blend.mp4', '2')
    # The blend moves the whole picture with her face; put her back on the room.
    run(f'{tools}/rebase.py', model, room, f'{tmp}/blend.mp4', f'{out}/{file}', '0', '0', '1')
    print('blend', file, flush=True)
