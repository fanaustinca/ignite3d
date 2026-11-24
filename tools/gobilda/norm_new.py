"""Kit-expansion parts (2026-11-23) outside the power-transmission family: holes modelled as several collinear segments
(clearance/countersink entry + tapped thread, seam splits) give extra snap faces INSIDE the material. Merge each hole line
into one snap per open outer face (tapped if any segment is threaded) -- same normalisation pt_overrides.py applies.
Writes overrides/SKU.json only when something changes and no hand-made override exists. Run after batch.py (occt python)."""
import json, os, sys, glob
import numpy as np
D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
src = open(os.path.join(D, 'pt_overrides.py')).read().split('def main')[0]
g = {'__file__': os.path.join(D, 'pt_overrides.py')}; exec(src, g)
from canon.rules_power_transmission import PREFIXES as PT
parts = json.load(open(os.path.join(D, 'parts.json'))); old = json.load(open(os.path.join(D, 'parts.before-kits.json')))
skus = sys.argv[1:] or [k for k in parts if k not in old and not k.startswith(tuple(PT))]
for sku in skus:
    f = os.path.join(D, 'out', f'{sku}.json'); ovp = os.path.join(D, 'overrides', f'{sku}.json')
    if not os.path.exists(f): continue
    if os.path.exists(ovp) and not json.load(open(ovp)).get('auto_norm'): continue
    d = json.load(open(f))
    sn = [s for s in d['snaps'] if not s.get('slotInterp')]
    axis = [s for s in sn if np.max(np.abs(s['n'])) > 0.999]
    obl = [s for s in sn if np.max(np.abs(s['n'])) <= 0.999]       # angled legs: both faces stay valid, keep as detected
    merged = g['merge_lines'](axis) + [dict(s) for s in obl]
    if len(merged) == len(sn) and all(any(np.allclose(m['p'], s['p'], atol=1e-3) for s in sn) for m in merged):
        if os.path.exists(ovp): os.remove(ovp)
        continue
    adds = [{k: v for k, v in s.items() if not k.startswith('_')} | {'id': 'n' + s['id']} for s in merged]
    ov = {'auto_norm': True, 'removeSnapIds': [s['id'] for s in sn], 'addSnaps': adds,
          'notes': f'norm_new: {len(sn)} detected hole faces -> {len(adds)} (collinear segments merged onto the outer faces)'}
    json.dump(ov, open(ovp, 'w'), indent=1)
    print(sku, len(sn), '->', len(adds))
