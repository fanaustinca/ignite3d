"""Wheels (axle along X, centred, axle axis through origin) and Viper-Slide kits (length along X, centred).
Mecanum SETS (3213/3625) may contain several wheels: framed by bbox only, flagged in notes."""
import numpy as np
from .lib import unit

MULTI = ('3213-', '3625-', '3624-')
PREFIXES = ['3213-', '3625-', '3601-', '3612-', '3614-', '3619-', '3613-', '3632-', '3624-', '3210-',
            '3600-', '3604-', '3607-', '3615-', '3618-', '3626-', '3627-', '3629-', '3635-', '3616-']
WHEEL_BORES = (4.0, 7.0, 16.0)

def _axis_of_wheel(ctx):
    score = {}
    for h in ctx['holes']:
        if min(abs(h['r'] - r) for r in WHEEL_BORES) < 0.25 and h.get('len', 0) > 3:
            d = unit(h['dir']); k = int(np.argmax(np.abs(d)))
            score.setdefault(k, []).append(h)
    if score:
        k = max(score, key=lambda k: sum(h['len'] for h in score[k]))
        return k, score[k]
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    return int(np.argmin(hi - lo)), []

def rule(ctx):
    sku = ctx['sku']
    lo, hi = np.array(ctx['bbox'][0], float), np.array(ctx['bbox'][1], float)
    ext = hi - lo; ctr = (lo + hi) / 2
    if sku.startswith('3210-'):
        k = int(np.argmax(ext)); order = {0: [0, 1, 2], 1: [1, 0, 2], 2: [2, 1, 0]}[k]
        R = np.zeros((3, 3))
        # new X = old k ; new Y = old axis of mid extent (kept up-ish); new Z = rest
        rest = [i for i in range(3) if i != k]
        y_old = rest[int(np.argmin(ext[rest]))] if False else rest[0]
        z_old = rest[1]
        R[0, k] = 1; R[1, y_old] = 1; R[2, z_old] = 1
        if np.linalg.det(R) < 0: R[2, z_old] = -1
        t = -R @ ctr
        return {'R': R.tolist(), 't': t.tolist(), 'male': [], 'notes': 'Viper-Slide kit: length along X, bbox-centred (y/z assignment unverified)'}
    k, segs = _axis_of_wheel(ctx)
    rest = [i for i in range(3) if i != k]
    R = np.zeros((3, 3)); R[0, k] = 1; R[1, rest[0]] = 1; R[2, rest[1]] = 1
    if np.linalg.det(R) < 0: R[2, rest[1]] = -1
    c = ctr.copy()
    if sku.startswith(MULTI):
        # many-solid wheels (rollers): OCC bbox is loose/inflated -> centre on the volume centroid (wheels are symmetric)
        c = np.array(ctx['centroid'], float)
    elif segs:
        big = max(segs, key=lambda h: h['len'])
        if sku.startswith(('3615-', '3618-', '3627-', '3629-')):   # flaps can carry r=4 holes too: take the one on the axis
            cen = np.array(ctx['centroid'], float)
            big = min(segs, key=lambda h: np.linalg.norm(np.delete(np.array(h['c0'], float) - cen, k)))
            if np.linalg.norm(np.delete(np.array(big['c0'], float) - cen, k)) > 2.0: segs = []   # no hole on the axis
        p = np.array(big['c0'], float)
        for i in rest: c[i] = p[i] if segs else c[i]
    if sku.startswith(('3615-', '3618-', '3627-', '3629-')) and 'REX' in ctx.get('title', '') and not any(abs(h['r'] - 4.0) < 0.15 for h in segs):
        # REX bores are planar hex facets (no cylinder to detect): centre the axle on the bore found on the mesh
        import os, sys
        D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if D not in sys.path: sys.path.insert(0, D)
        from extract import load, tessellate
        from mount_bores import find_near
        P, _ = tessellate(load(os.path.join(D, 'step', f'{sku}.STEP')))
        o = [i for i in range(3) if i != k]
        cen = np.array(ctx['centroid'], float)
        f = find_near(P.astype(float), k, [cen[o[0]], cen[o[1]]])
        if f:
            c[o[0]], c[o[1]] = f[1][0], f[1][1]
            note_rex = f'; axle centred on the REX bore (mesh, clearance r {f[2]:.2f})'
    t = -R @ c
    note = 'wheel: axle along X' + (locals().get('note_rex') or '')
    if sku.startswith(('3213-', '3625-')):
        note += '; single mecanum wheel (STEP is one wheel, not a set of 4); centred on volume centroid'
    return {'R': R.tolist(), 't': t.tolist(), 'male': [], 'notes': note}
