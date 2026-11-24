"""Bore snaps for mounts / pillow blocks whose bore the hole detector cannot see: 8 mm REX bores are planar hex facets in
goBILDA's STEP (no cylinder). Finds the bore on the real mesh (largest vertex-free circle of the bore's size, ringed all
round by bore vertices, along a part axis), then adds rex_8mm snaps on both open faces with the hex corner as upVector.
Merges into overrides/SKU.json (keeps other override content). Run with the occt python after batch.py.
  python mount_bores.py [SKU ...]"""
import json, os, re, sys
import numpy as np
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from extract import load, tessellate
src = open(os.path.join(D, 'pt_overrides.py')).read().split('def main')[0]
g = {'__file__': os.path.join(D, 'pt_overrides.py')}; exec(src, g)
parts = json.load(open(os.path.join(D, 'parts.json')))
MOUNT = re.findall(r"'(\d{4}-[\d-]*)'", open(os.path.join(D, 'canon', 'rules_motors_mounts.py')).read().split('def ')[0])

def find(Q, r_in=3.5):
    best = None
    for ax in range(3):
        o = [i for i in range(3) if i != ax]; P = Q[:, o]
        lo, hi = P.min(0), P.max(0)
        def score(c, tol=1.0):
            d = np.linalg.norm(P - c, axis=1)
            if d.min() < r_in - tol: return -1, None
            ring = d < r_in + 0.6
            if ring.sum() < 12: return -1, None
            th = np.sort(np.arctan2(*(P[ring] - c).T[::-1]))
            gap = np.max(np.diff(np.concatenate([th, [th[0] + 2 * np.pi]])))
            return (2 * np.pi - gap) - abs(d.min() - r_in), d.min()
        xs = np.arange(lo[0] + r_in - 1, hi[0] - r_in + 1 + 1e-9, 0.5); zs = np.arange(lo[1] + r_in - 1, hi[1] - r_in + 1 + 1e-9, 0.5)
        for x in xs:
            for z in zs:
                c = np.array([x, z]); sc, dm = score(c)
                if sc < 4.4: continue
                for step in (0.25, 0.05, 0.01):      # refine: centre of the empty circle (maximise the clearance)
                    cand = [c + np.array([dx, dz]) * step for dx in range(-4, 5) for dz in range(-4, 5)]
                    c = max(cand, key=lambda q: np.linalg.norm(P - q, axis=1).min())
                sc, dm = score(c, 0.12)
                if sc > 4.6 and dm < 4.3 and (best is None or sc > best[0]): best = (sc, ax, c, dm)   # sharp hex: vertices only at the 4.04 corners
    if best is None: return None
    return best[1], best[2], best[3]

def find_near(Q, ax, c0, r_in=3.5):
    """Wheels: rotationally symmetric, so the bore is on the volume-centroid axis; refine the empty circle within 1.5 mm."""
    o = [i for i in range(3) if i != ax]; P = Q[:, o]; c = np.array(c0, float)
    for step in (0.25, 0.05, 0.01):
        cand = [c + np.array([dx, dz]) * step for dx in range(-6, 7) for dz in range(-6, 7)]
        cand = [q for q in cand if np.linalg.norm(q - c0) <= 1.5]
        c = max(cand, key=lambda q: np.linalg.norm(P - q, axis=1).min())
    dm = float(np.linalg.norm(P - c, axis=1).min())
    return (ax, c, dm) if 3.3 <= dm <= 4.3 else None

def run(sku):
    d = json.load(open(os.path.join(D, 'out', f'{sku}.json')))
    P, _ = tessellate(load(os.path.join(D, 'step', f'{sku}.STEP')))
    Q = P.astype(float) @ np.array(d['R']).T + np.array(d['t'])
    if sku[:2] == '36':   # wheel: axle = X
        f = find_near(Q, 0, [d['centroid'][1], d['centroid'][2]])
    else:
        f = find(Q)
    if not f: print(sku, 'bore not found'); return
    ax, c, rmin = f
    c = np.where(np.abs(c) < 0.05, 0.0, c)    # mesh-vertex noise: the bore sits on the part's centre line
    o = [i for i in range(3) if i != ax]
    rr = np.hypot(Q[:, o[0]] - c[0], Q[:, o[1]] - c[1]); m = rr < 4.3
    y0, y1 = float(Q[m, ax].min()), float(Q[m, ax].max())
    if ax != 1: print(sku, f'bore axis {"xyz"[ax]} (not Y)')
    snaps = []
    for i, (y, s) in enumerate(((y0, -1), (y1, 1))):
        p = [0.0, 0.0, 0.0]; p[ax] = round(y, 4); p[o[0]] = round(float(c[0]), 4); p[o[1]] = round(float(c[1]), 4)
        n = [0.0, 0.0, 0.0]; n[ax] = float(s)
        snaps.append({'id': f'rexbore{"ab"[i]}', 'type': 'rex_8mm', 'p': p, 'n': n, 'depth': round(y1 - y0, 3), 'tapped': False, 'holeId': 'rexbore', 'full': True})
    if ax == 1:   # hex corner orientation: 6-fold mean angle of the vertices on the rounded corner arcs (r 3.85-4.05)
        sel = m & (rr > 3.85) & (rr < 4.05) & (Q[:, 1] > y0 - 0.05) & (Q[:, 1] < y1 + 0.05)
        th = np.arctan2(Q[sel, 2] - c[1], Q[sel, 0] - c[0])
        phi = float(np.angle(np.exp(6j * th).sum()) / 6) if sel.sum() >= 6 else None
        if phi is not None and abs(np.degrees(phi)) < 0.5: phi = 0.0
        if phi is not None:
            for s_ in snaps: s_['up'] = [round(float(np.cos(phi)), 5), 0.0, round(float(np.sin(phi)), 5)]
    ovp = os.path.join(D, 'overrides', f'{sku}.json')
    ov = json.load(open(ovp)) if os.path.exists(ovp) else {}
    ov['addSnaps'] = [s for s in ov.get('addSnaps', []) if s.get('holeId') != 'rexbore'] + snaps
    ov['notes'] = (ov.get('notes', '') + f' | mount_bores: REX bore at {np.round(c, 3).tolist()} axis {"xyz"[ax]}, clearance r {rmin:.2f}, faces {y0:.3f}..{y1:.3f}').strip(' |')
    json.dump(ov, open(ovp, 'w'), indent=1)
    print(sku, 'axis', 'xyz'[ax], 'centre', np.round(c, 3), 'r', round(rmin, 3), 'faces', round(y0, 3), round(y1, 3), 'up', snaps[0].get('up'))

if __name__ != '__main__': skus = []
elif sys.argv[1:]: skus = sys.argv[1:]
else: skus = [k for k, v in sorted(parts.items()) if k.startswith(tuple(MOUNT)) and 'REX' in v['title'] and not k.startswith(('520', '530'))
                        and os.path.exists(os.path.join(D, 'out', f'{k}.json'))]
for s in skus: run(s)
