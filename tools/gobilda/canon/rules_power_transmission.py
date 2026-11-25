"""power_transmission: shafts, hubs, bearings, collars, gears, pulleys, universal joint.

Frames (all axis = Y, axis through origin in XZ):
  shafts      : centred in Y; male endA (low end, n=+Y) / endB (high end, n=-Y).
  hubs/gears/pulleys/collars/bearings(non-flanged): bore axis -> Y, bbox centred in Y.
  flanged bearing 1611: flange underside at y=0, 14 mm barrel toward -Y, male bearing_14mm n=(0,-1,0).
Typing of hole snaps (hub_pattern_16mm for hub threads, bore retypes) is done in pt_overrides.py -> overrides/*.json.
"""
import numpy as np
from . import lib
from .lib import unit, frame, snap_axis, male

PREFIXES = ['2101-', '2102-', '2106-', '2109-', '1309-', '1310-', '2910-', '1600-', '1611-', '4005-',
            '2302-', '2303-', '2304-', '2312-', '2315-', '2317-', '2319-', '2320-', '2322-', '3204-',
            '3411-', '3415-', '3417-', '3418-', '3424-',
            # kit/popular expansion (2026-11-23)
            '1301-', '1308-', '1311-', '1312-', '1313-', '1314-', '1315-', '2920-', '2923-', '1601-', '1607-', '1609-',
            '1612-', '1613-', '1626-', '2305-', '2401-', '3302-', '3307-', '3310-', '3311-', '3312-', '3410-', '3413-',
            '3421-', '3422-', '3427-', '3428-', '4001-', '4006-', '4007-', '1900-', '1902-', '1906-', '1908-', '1921-',
            '1910-', '1911-', '1922-', '1923-', '2105-', '2110-', '3500-', '3501-', '3503-', '3504-', '3505-', '3506-', '3508-',
            # round 5 (2026-11-24): control arms / discs, CV joints, round shafts, tubes, pulleys, flywheels, turret, track
            '1914-', '1916-', '1917-', '1918-', '1919-', '1920-', '1925-', '2108-', '2100-', '4100-', '3407-', '3408-',
            '3628-', '3208-', '1608-', '2405-', '2411-']
SHAFT = ('2101-', '2102-', '2106-', '2109-', '3501-', '2100-')
BORE_R = lambda r: 1.57 <= r <= 1.6 or 2.95 <= r <= 3.3 or 3.9 <= r <= 4.95 or 6.8 <= r <= 7.25

import os, sys
_D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def tight_bbox(sku):
    """ctx['bbox'] is OCC's loose bbox (can be ~0.3 mm too big); measure the real mesh instead (Y-up coords)."""
    if _D not in sys.path: sys.path.insert(0, _D)
    from extract import load, tessellate
    P, _ = tessellate(load(os.path.join(_D, 'step', f'{sku}.STEP')))
    return [P.min(0).astype(float).tolist(), P.max(0).astype(float).tolist()]

def _rot(axis, bbox):
    R = snap_axis(frame(axis))
    lo, hi = np.array(bbox[0]), np.array(bbox[1])
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ R.T
    return R, corners

def bore_axis(ctx):
    """Axis of the main bore: classified bore cylinders, longest total length; else the thinnest bbox axis."""
    tot = {}
    for h in ctx['holes']:
        if BORE_R(h['r']) and (h['full'] or h.get('arc', 0) >= 1.0):
            k = tuple(np.round(h['dir'], 4)); tot[k] = tot.get(k, 0) + h['len']
    if tot:
        return np.array(max(tot, key=tot.get))
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    return np.eye(3)[int(np.argmin(hi - lo))]

def bore_center(ctx, axis):
    a = unit(axis); pts = []
    for h in ctx['holes']:
        if BORE_R(h['r']) and abs(abs(np.dot(unit(h['dir']), a)) - 1) < 1e-4 and (h['full'] or h.get('arc', 0) >= 1.0):
            pts.append(np.array(h['c0']))
    if not pts and ctx['sku'][:4] in ('1301', '1308', '1314'):
        # bores without an Ignite3D snap type (3/16", 3 mm, 10 mm...): centre on the largest full hole along the axis,
        # not the bbox (clamp lugs make hubs asymmetric) so the 16 mm pattern lands on +-8 mm
        hs = [h for h in ctx['holes'] if (h['full'] or h.get('arc', 0) >= 3.0) and abs(abs(np.dot(unit(h['dir']), a)) - 1) < 1e-4 and h['r'] > 2.5] or \
             [h for h in ctx['holes'] if h['full'] and abs(abs(np.dot(unit(h['dir']), a)) - 1) < 1e-4 and h['r'] > 1.45]   # clamp slit -> partial bore arc
        if hs and max(h['r'] for h in hs) > 2.5: pts = [np.array(max(hs, key=lambda h: h['r'])['c0'])]
        else:   # 12 mm REX bore = planar hex facets: centre of the 16 mm square of pattern holes
            P = [np.array(h['c0']) for h in hs]; o_ = [i for i in range(3) if abs(a[i]) < 0.5]
            for p in P:
                q = lambda du, dv: any(abs(x[o_[0]] - p[o_[0]] - du) < 0.3 and abs(x[o_[1]] - p[o_[1]] - dv) < 0.3 for x in P)
                if q(16, 0) and q(0, 16) and q(16, 16):
                    c = p.copy(); c[o_[0]] += 8; c[o_[1]] += 8; pts = [c]; break
            if not pts and hs: pts = [np.array(max(hs, key=lambda h: h['r'])['c0'])]
    return np.mean(pts, axis=0) if pts else (np.array(ctx['bbox'][0]) + np.array(ctx['bbox'][1])) / 2

def rule(ctx):
    sku = ctx['sku']
    ctx = dict(ctx, bbox=tight_bbox(sku))
    if sku.startswith(SHAFT):
        lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
        ax = np.eye(3)[int(np.argmax(hi - lo))]
        R, c = _rot(ax, ctx['bbox'])
        mn, mx = c.min(0), c.max(0)
        ax_pts = [np.array(b['c0']) for b in lib.bosses_along(ctx, ax, 2.9, 5.0)] + [np.array(h['c0']) for h in ctx['holes'] if abs(abs(np.dot(unit(h['dir']), ax)) - 1) < 1e-4 and 1.6 <= h['r'] <= 2.1]
        ctr = R @ np.mean(ax_pts, axis=0) if ax_pts else (mn + mx) / 2
        t = -np.array([ctr[0], (mn[1] + mx[1]) / 2, ctr[2]])
        L = mx[1] - mn[1]
        typ = 'rex_8mm' if sku.startswith(('2106-', '2105-', '2100-0008-')) else 'd_6mm' if sku.startswith(('2101-', '2100-0006-')) else None
        mm = []
        if typ:
            mm = [male('endA', typ, (0, -L / 2, 0), (0, 1, 0)), male('endB', typ, (0, L / 2, 0), (0, -1, 0))]
        return {'R': R.tolist(), 't': t.tolist(), 'male': mm,
                'notes': f'shaft L={L:.2f}; male {typ or "none (12 mm REX has no Ignite3D type)"} at both ends'}
    if sku.startswith('2110-'):
        # Shouldered REX hub-shaft (STEP = hub + shaft + retaining shim/washer/M4 screw at the tip, as shipped).
        # Frame: shaft axis = Y, origin on the axis at the shoulder plane where the 8 mm REX section starts,
        # hub toward +Y, tip toward -Y. Male rex_8mm at the shoulder, normal -Y (insertion: tip-first into a bearing).
        hub = max(ctx['bosses'], key=lambda b: b['r'])                       # 32 mm hub flange (r=16)
        a = unit(hub['dir'])
        rex = max([b for b in ctx['bosses'] if 3.9 <= b['r'] <= 4.1 and abs(abs(np.dot(unit(b['dir']), a)) - 1) < 1e-4], key=lambda b: b['len'])
        hc = (np.array(hub['c0']) + np.array(hub['c1'])) / 2
        e0, e1 = np.array(rex['c0']), np.array(rex['c1'])
        sh = e0 if np.linalg.norm(e0 - hc) < np.linalg.norm(e1 - hc) else e1   # REX end nearest the hub = shoulder
        u = unit(hc - sh); u = u * np.sign(np.dot(u, a)) if abs(np.dot(u, a)) > 0.99 else u
        u = unit(a * np.sign(np.dot(hc - sh, a)))
        R = snap_axis(frame(u))
        t = -R @ sh
        return {'R': R.tolist(), 't': t.tolist(),
                'male': [male('shoulder', 'rex_8mm', (0, 0, 0), (0, -1, 0))],
                'notes': f'hub-shaft: axis Y, y=0 at REX shoulder, hub +Y ({np.dot(hc - sh, u):.2f} mm to hub centre), tip -Y; REX length {rex["len"]:.2f}'}
    axis = bore_axis(ctx)
    if sku.startswith(('1910-', '1911-', '1922-', '1923-', '2105-')):   # stub / servo shafts: axis = the shaft itself
        sh = max([b for b in ctx['bosses'] if b['r'] > 3], key=lambda b: b['len'])
        axis = np.round(unit(sh['dir']))
    R, c = _rot(axis, ctx['bbox'])
    ctr = R @ bore_center(ctx, axis)
    mn, mx = c.min(0), c.max(0)
    t = -np.array([ctr[0], (mn[1] + mx[1]) / 2, ctr[2]])
    if sku.startswith(('1611-', '1601-')):
        # flange = widest boss; barrel toward -Y; underside plane at y=0
        bs = [(b['r'], b) for b in ctx['bosses'] if abs(abs(np.dot(unit(b['dir']), unit(axis))) - 1) < 1e-4]
        flange = max(bs, key=lambda x: x[0])[1] if bs else None
        ys = [(R @ np.array(flange[k]))[1] for k in ('c0', 'c1')] if flange else [mn[1], mx[1]]
        mid = (mn[1] + mx[1]) / 2
        if (min(ys) + max(ys)) / 2 < mid:  # flange at low end -> flip so flange is at +Y
            F = np.diag([1, -1, -1.0]); R = F @ R; c = c @ F.T; ctr = R @ bore_center(ctx, axis)
            mn, mx = c.min(0), c.max(0)
            ys = [(R @ np.array(flange[k]))[1] for k in ('c0', 'c1')]
        under = min(ys)
        t = -np.array([ctr[0], under, ctr[2]])
        return {'R': R.tolist(), 't': t.tolist(), 'male': [male('barrel', 'bearing_14mm', (0, 0, 0), (0, -1, 0))],
                'notes': 'flange underside y=0, barrel toward -Y'}
    return {'R': R.tolist(), 't': t.tolist(), 'male': [], 'notes': f'bore axis -> Y, centred in Y'}
