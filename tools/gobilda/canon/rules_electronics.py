"""REV Control Hub (REV-31-1595) and Expansion Hub (REV-31-1153).

Frame: thickness along Y, mounting base at y = 0 with the lid toward +Y, long side (143 mm) along X, centred on
the 4 M3 mounting holes (128 x 88 mm pattern = 16 x 11 goBILDA 8 mm pitches, so the hub lands on grid holes).
The mounting-hole snaps themselves are written by overrides (hand-checked against REV's drawing REV-31-1153-DR).
"""
import numpy as np
from .lib import frame, unit

PREFIXES = ['REV-31-']


def _corners(ctx, R):
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    return np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ R.T


def rule(ctx):
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    ext = hi - lo
    thin = int(np.argmin(ext))
    long_ = int(np.argmax(ext))
    R = frame(np.eye(3)[thin], np.eye(3)[long_])
    R = np.round(R) if np.allclose(np.round(R), R, atol=1e-6) else R
    c = _corners(ctx, R)
    mid = (c.min(0) + c.max(0)) / 2
    # the base plate (with the mounting flange) is heavier than the hollow lid: centroid sits below mid-height
    if (R @ np.array(ctx['centroid']))[1] > mid[1]:
        R = np.diag([1, -1, -1.0]) @ R
        c = _corners(ctx, R)
        mid = (c.min(0) + c.max(0)) / 2
    # centre on the 4 mounting holes when they are found (axis along Y, M3 clearance r 1.5..2.0)
    ys = []
    for h in ctx['holes']:
        if abs(abs(np.dot(R @ unit(h['dir']), [0, 1, 0])) - 1) < 1e-3 and 1.5 <= h['r'] <= 2.0:
            ys.append(R @ np.array(h['c0']))
    cx, cz = mid[0], mid[2]
    if ys:
        P = np.array(ys)
        # mounting holes are the ones nearest the four corners of the footprint
        quad = []
        for sx in (-1, 1):
            for sz in (-1, 1):
                corner = np.array([mid[0] + sx * 1e3, 0, mid[2] + sz * 1e3])
                quad.append(P[np.argmin(np.linalg.norm((P - corner)[:, [0, 2]], axis=1))])
        Q = np.array(quad)
        cx, cz = Q[:, 0].mean(), Q[:, 2].mean()
    t = np.array([-cx, -c.min(0)[1], -cz])
    return {'R': np.asarray(R).tolist(), 't': t.round(5).tolist(), 'male': [],
            'notes': 'REV hub: thin axis -> Y, base at y=0 (lid +Y), long side X, centred on the 4 corner M3 holes'}
