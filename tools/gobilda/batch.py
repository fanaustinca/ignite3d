"""Convert every downloaded STEP (parallel processes; OCCT is not thread-safe), then Draco-compress meshes.
python batch.py [--force] [SKU ...]"""
import json, os, subprocess, sys
from concurrent.futures import ProcessPoolExecutor, as_completed
D = os.path.dirname(os.path.abspath(__file__))
PY = os.path.expanduser('~/miniforge3/envs/occt/bin/python')

def one(sku):
    out = os.path.join(D, 'out', f'{sku}.json')
    r = subprocess.run([PY, os.path.join(D, 'convert.py'), sku], capture_output=True, text=True, timeout=14400)
    line = next((l for l in r.stdout.splitlines() if l.startswith('{"sku"')), None)
    if r.returncode or not line:
        return sku, 'ERROR ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200]
    glb = os.path.join(D, 'out', f'{sku}.glb')
    dr = os.path.join(D, 'out', f'{sku}.draco.glb')
    d = subprocess.run(['npx', 'gltf-transform', 'draco', glb, dr], capture_output=True, text=True, cwd=D, timeout=600)
    return sku, line if d.returncode == 0 else 'DRACO-FAIL ' + d.stderr[-200:]

if __name__ == '__main__':
    force = '--force' in sys.argv
    jobs = int(sys.argv[sys.argv.index('--jobs') + 1]) if '--jobs' in sys.argv else 16
    args = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and sys.argv[i - 1] != '--jobs']
    want = [a for a in args if os.path.exists(os.path.join(D, 'step', f'{a}.STEP'))]
    missing = [a for a in args if a not in want]
    if missing: print('not downloaded yet:', ' '.join(missing), flush=True)
    if args and not want: sys.exit(0)
    have = sorted(f[:-5] for f in os.listdir(os.path.join(D, 'step')) if f.endswith('.STEP'))
    todo = [s for s in (want or have) if force or want or not os.path.exists(os.path.join(D, 'out', f'{s}.draco.glb'))]
    print('converting', len(todo), flush=True)
    with ProcessPoolExecutor(max_workers=jobs) as ex:
        futs = {ex.submit(one, s): s for s in todo}
        for f in as_completed(futs):
            sku, msg = f.result()
            print(sku, msg, flush=True)
    print('BATCH DONE', flush=True)
