"""Family motors_mounts: goBILDA motors, servos, mounts, blocks, brackets, pillow blocks.

Core: rebuild_snaps() replaces the converter's per-segment snaps with cluster-based hole snaps:
  * hole segments on the same axis line and same class are merged (bridging thread run-out gaps and gaps
    caused by a crossing hole), so only REAL openings at the part surface get a snap (no snaps inside a
    cross-drilled hole);
  * r=1.65 (minor-dia thread, usually modelled together with an r=2.0 major cylinder) => tapped m4_hole; r=2.0 alone
    => clearance m4_hole; r=7 => bearing_14mm; r~4 / hex 4.5 => rex_8mm; r~3 => d_6mm;
  * oblong slots (pairs of half-arcs) longer than 2 mm get extra snaps at 1 mm spacing along the centreline
    (ids <holeId>s<k>).
"""
import math
import numpy as np
from .lib import unit, frame, male

PREFIXES = ['5202-', '5203-', '5204-', '2000-', '2002-', '2004-', '3348', '3202-', '3217-', '1141-', '1142-', '1201-',
            '1202-', '1203-', '1204-', '1205-', '1211-', '1222-', '1108-', '1302-', '1305-', '1400-', '1401-',
            '1601-', '1602-', '1605-', '1700-', '1701-', '1702-', '1704-', '2902-']


def seg_class(h):
    """(type, tapped_minor) of a hole segment or None."""
    r = h['r']
    if 1.45 <= r < 1.85: return 'm4_hole', True
    if 1.85 <= r <= 2.45: return 'm4_hole', False
    if 2.95 <= r <= 3.1: return 'd_6mm', False
    if 3.9 <= r <= 4.1: return 'rex_8mm', False
    if 4.2 <= r <= 4.95: return 'rex_8mm', False
    if 6.8 <= r <= 7.25: return 'bearing_14mm', False
    return None


def min_arc(h):
    r = h['r']
    if 4.2 <= r <= 4.95: return 1.0
    return 2.8


def _axis_dist(p, q, d):
    v = np.asarray(p) - np.asarray(q)
    return np.linalg.norm(v - d * v.dot(d))


def rebuild_snaps(ctx, slot_step=1.0, report=None):
    holes = ctx['holes']
    segs = []
    for k, h in enumerate(holes):
        c = seg_class(h)
        if not c: continue
        if not h['full'] and h['arc'] < min_arc(h): continue
        d = unit(h['dir'])
        c0, c1 = np.array(h['c0']), np.array(h['c1'])
        # canonical sign so that c0 is the low end along d
        if d.dot(c1 - c0) < 0: c0, c1 = c1, c0
        segs.append({'k': k, 'h': h, 'cls': c, 'd': d, 'c0': c0, 'c1': c1, 'o0': h['open0'], 'o1': h['open1'], 'r': h['r']})
    # cross-hole test: does another-direction hole (any radius) pass through point p?
    allh = []
    for h in holes:
        if h['r'] > 4.2 and h['r'] < 6: continue
        d = unit(h['dir'])
        allh.append((d, np.array(h['c0']), np.array(h['c1']), h['r']))

    def crossing(base, d, g0, g1):
        """Is the gap [g0,g1] of the line (base,d) caused by a perpendicular hole whose axis crosses it?"""
        for (d2, a, b, r2) in allh:
            if abs(d2.dot(d)) > 1e-3: continue
            # closest approach of the two lines
            w = base - a
            den = 1 - d.dot(d2) ** 2
            t = (d.dot(d2) * w.dot(d2) - w.dot(d)) / den if den > 1e-9 else 0
            q = base + d * t
            if _axis_dist(q, a, d2) > 0.35: continue
            if not (g0 - 0.35 <= t <= g1 + 0.35): continue
            u = d2.dot(q - a); L = d2.dot(b - a)
            lo, hi = min(0, L), max(0, L)
            if lo - 3.5 <= u <= hi + 3.5: return True
        return False

    # group by (class type, axis line)
    groups = {}
    for s in segs:
        d = s['d']; base = s['c0'] - d * d.dot(s['c0'])
        for key, g in groups.items():
            if key[0] == s['cls'][0] and np.allclose(g[0]['d'], d, atol=1e-3) and np.linalg.norm(g[0]['base'] - base) < 0.2:
                g.append({**s, 'base': g[0]['base']}); break
        else:
            groups[(s['cls'][0], len(groups))] = [{**s, 'base': base}]
    snaps = []
    n = 0
    for key, ss in groups.items():
        d = ss[0]['d']; base = ss[0]['base']
        iv = sorted([[d.dot(s['c0']), d.dot(s['c1']), s['o0'], s['o1'], s] for s in ss], key=lambda x: x[0])
        merged = []
        for a, b, o0, o1, s in iv:
            if merged:
                m = merged[-1]
                gap = a - m[1]
                if gap <= 2.0 or (gap <= 5.0 and crossing(base, d, m[1], a)):
                    if b > m[1]: m[1], m[3] = b, o1
                    m[4].append(s)
                    continue
            merged.append([a, b, o0, o1, [s]])
        for a, b, o0, o1, ss2 in merged:
            tapped = any(s['cls'][1] for s in ss2) or (not o0) or (not o1)
            full = any(s['h']['full'] for s in ss2)
            arc = max(s['h']['arc'] for s in ss2)
            typ = key[0]
            hid = f'h{n}'; n += 1
            ln = b - a
            for end, (t_, sg, op) in enumerate(((a, -1, o0), (b, 1, o1))):
                if not op: continue
                snaps.append({'id': f'{hid}{"ab"[end]}', 'type': typ, 'p': (base + d * t_).tolist(), 'n': (d * sg).tolist(),
                              'depth': round(ln, 4), 'tapped': bool(tapped), 'holeId': hid, 'full': bool(full),
                              '_arc': arc, '_r': max(s['r'] for s in ss2), '_ln': ln})
    # slots: pairs of ~half-arc holes with same dir/extent/type, centres closer than 3x pitch
    arcs = [s for s in snaps if s['_arc'] < 3.5 and not s['full']]
    extra = []
    def cand(s, t):
        if t['holeId'] == s['holeId'] or t['type'] != s['type'] or abs(t['_r'] - s['_r']) > 0.01: return None
        if np.dot(s['n'], t['n']) < 0.99 or abs(t['depth'] - s['depth']) > 0.05: return None
        dp = np.array(t['p']) - np.array(s['p'])
        if abs(dp.dot(np.array(s['n']))) > 0.02: return None
        L = np.linalg.norm(dp)
        return L if 0.2 < L < 60 else None
    best = {}
    for i, s in enumerate(arcs):
        bj, bl = None, 1e9
        for j, t in enumerate(arcs):
            if i == j: continue
            L = cand(s, t)
            if L is not None and L < bl: bj, bl = j, L
        best[i] = bj
    for i, j in best.items():
        if j is None or best.get(j) != i or j < i: continue
        s, t = arcs[i], arcs[j]
        dp = np.array(t['p']) - np.array(s['p']); L = float(np.linalg.norm(dp))
        if report is not None: report.append(round(L, 3))
        if L > 2.0:
            for q in range(1, int(math.floor(L / slot_step - 1e-6)) + 1):
                if q * slot_step > L - 0.05: break
                extra.append({**s, 'id': f'{s["holeId"]}s{q}{s["id"][-1]}', 'p': (np.array(s['p']) + dp / L * q * slot_step).tolist()})
    for s in snaps + extra:
        for k in ('_arc', '_r', '_ln'): s.pop(k, None)
    for s in snaps:
        for k in ('_arc', '_r', '_ln'): s.pop(k, None)
    ctx['snaps'][:] = snaps + extra
    return ctx['snaps']


def find_bore(ctx):
    """Largest axis-aligned full concave cylinder with 6.8 <= r <= 19 (motor bore / bearing bore)."""
    best = None
    if ctx['sku'].startswith('1701-'):   # motor pilot boss (r=16) instead of a bore
        for b in ctx['bosses']:
            if abs(b['r'] - 16.0) < 0.1 and max(abs(unit(b['dir']))) > 0.9999: return b
    for h in ctx['holes']:
        if not (6.8 <= h['r'] <= 19.0) or not h['full'] or h['len'] < 2: continue
        d = np.abs(unit(h['dir']))
        if d.max() < 0.9999: continue
        if best is None or h['r'] > best['r'] or (h['r'] == best['r'] and h['len'] > best['len']): best = h
    if best is None:   # small bores (pillow blocks 4-12 mm): largest axis-aligned full hole with r > 2.5 parallel to the thin axis
        ext = np.array(ctx['bbox'][1]) - np.array(ctx['bbox'][0]); th = int(np.argmin(ext))
        for h in ctx['holes']:
            if h['r'] <= 2.5 or not h['full'] or abs(unit(h['dir'])[th]) < 0.9999: continue
            if best is None or h['r'] > best['r']: best = h
    return best


def thin_axis_frame(ctx, axis=None):
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    ext = hi - lo
    a = int(np.argmin(ext)) if axis is None else axis
    # axis a -> Y; proper rotations only
    if a == 1: R = np.eye(3)
    elif a == 2: R = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)  # z -> y
    else: R = np.array([[0, 1, 0], [-1, 0, 0], [0, 0, 1]], float)  # x -> y
    return R


def motor_rule(ctx, rep):
    """Yellow Jacket motors: shaft = longest convex r=3 (D) / r=4 (REX) cylinder; +Y points to the free shaft end; y=0 is
    the front mounting plane (end of the face-pattern pads); origin on the shaft axis."""
    cand = [b for b in ctx['bosses'] if (2.9 <= b['r'] <= 3.1 or 3.9 <= b['r'] <= 4.1) and b['len'] >= 12]
    cand = [b for b in cand if abs(abs(np.dot(unit(b['dir']), [1, 0, 0])) - 1) < 1e-3 or abs(abs(np.dot(unit(b['dir']), [0, 1, 0])) - 1) < 1e-3 or abs(abs(np.dot(unit(b['dir']), [0, 0, 1])) - 1) < 1e-3]
    sh = max(cand, key=lambda b: b['len'])
    a = unit(sh['dir'])
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    cen = (lo + hi) / 2
    e0, e1 = np.array(sh['c0']), np.array(sh['c1'])
    u = a if a.dot(e1 - cen) > a.dot(e0 - cen) and a.dot(e1) > a.dot(e0) else -a
    far = e1 if u.dot(e1) > u.dot(e0) else e0
    base = far - u * u.dot(far)                     # a point on the shaft axis (u-coordinate 0)
    rs = sh['r']
    typ = 'd_6mm' if rs < 3.5 else 'rex_8mm'
    # face plane: pads (convex r 3.5-4.5, parallel to axis, 10-13 mm off-axis); fallback: shaft root
    ends = []
    for b in ctx['bosses']:
        if abs(abs(np.dot(unit(b['dir']), u)) - 1) > 1e-3 or not (3.5 <= b['r'] <= 4.5): continue
        c = np.array(b['c0']); rad = np.linalg.norm((c - base) - u * u.dot(c - base))
        if 10.0 <= rad <= 13.0: ends.append(max(u.dot(b['c0']), u.dot(b['c1'])))
    if not ends:
        face = min(u.dot(e0), u.dot(e1))
    else:
        face = max(ends)
        # the true flat mounting land is usually a fraction of a mm proud of the pad tops: take the dominant
        # planar level just beyond the pad ends from the tessellation
        try:
            import os
            from extract import load, tessellate
            P, _ = tessellate(load(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'step', ctx['sku'] + '.STEP')))
            P = P.astype(float); uc = P @ u
            rad = np.linalg.norm((P - base) - np.outer(uc - u.dot(base), u) - 0 * P, axis=1) if False else np.linalg.norm(P - base - np.outer((P - base) @ u, u), axis=1)
            sel = (uc > face + 0.02) & (uc < face + 1.5) & (rad > 7.6) & (rad < 18)
            if sel.sum() > 200:
                lv = np.round(uc[sel] / 0.01) * 0.01
                vals, cnt = np.unique(lv, return_counts=True)
                if cnt.max() > 0.5 * sel.sum() or cnt.max() > 400: face = float(vals[np.argmax(cnt)])
        except Exception as e:
            rep.append('land-detect-failed')
    keep = []
    for sn in ctx['snaps']:
        n = np.array(sn['n']); p = np.array(sn['p'])
        if abs(abs(n.dot(u)) - 1) < 1e-3:
            rad = np.linalg.norm((p - base) - u * u.dot(p - base))
            dy = u.dot(p) - face
            if rad < 0.3 and dy > 5:
                if dy > 0 and abs(n.dot(u) - 1) < 1e-3: pass
                keep.append(sn)            # tapped end hole in the shaft tip
            elif -4.5 <= dy <= 0.6 and rad > 5:                   # face pattern holes
                if abs(dy) <= 0.4: sn['p'] = (p - u * dy).tolist()   # thread chamfer overshoots the land by <=0.35
                keep.append(sn)
        else:
            keep.append(sn)                                     # gearbox side holes
    ctx['snaps'][:] = keep
    R = frame(u, (1, 0, 0))
    R = np.round(R) if np.allclose(np.round(R), R, atol=1e-6) else R
    p0 = base + u * face
    t = -R @ p0
    m = male('shaft', typ, [0, 0, 0], [0, 1, 0], up=(1, 0, 0))
    return {'R': R.tolist(), 't': np.round(t, 5).tolist(), 'male': [m],
            'notes': f'motor: shaft r={rs} -> {typ}, +Y toward shaft tip, y=0 at front face plane (pad ends); shaft axis at origin'}


def servo_rule(ctx, rep):
    """Servos: output spline axis -> +Y; origin on the spline axis at the root of the spline boss (case-top plane).
    Male reference snap 'spline' (type spline_25t, documented) at the origin, normal +Y. Tab holes stay female clearance."""
    cand = [b for b in ctx['bosses'] if 2.8 <= b['r'] <= 3.3 and b['len'] >= 3 and max(abs(unit(b['dir']))) > 0.9999]
    if not cand:
        return None
    top = max(cand, key=lambda b: max(unit(b['dir']).dot(b['c0']), unit(b['dir']).dot(b['c1'])) * 0 + b['len'])
    a = unit(top['dir'])
    c0, c1 = np.array(top['c0']), np.array(top['c1'])
    cen = np.array(ctx['centroid'])
    u = a if a.dot(c1 - cen) > 0 else -a
    group = [b for b in cand if abs(abs(unit(b['dir']).dot(a)) - 1) < 1e-4 and np.linalg.norm((np.array(b['c0']) - c0) - a * a.dot(np.array(b['c0']) - c0)) < 0.2]
    root = min(min(u.dot(b['c0']), u.dot(b['c1'])) for b in group)
    base = c0 - a * a.dot(c0)
    keep = []
    for sn in ctx['snaps']:
        n = np.array(sn['n']); p = np.array(sn['p'])
        rad = np.linalg.norm((p - base) - u * u.dot(p - base))
        if rad < 0.3 and n.dot(u) < 0: continue     # blind bottom of the spline screw hole
        keep.append(sn)
    ctx['snaps'][:] = keep
    R = frame(u, (1, 0, 0)); R = np.round(R) if np.allclose(np.round(R), R, atol=1e-6) else R
    t = -R @ (base + u * root)
    return {'R': R.tolist(), 't': np.round(t, 5).tolist(), 'male': [male('spline', 'spline_25t', [0, 0, 0], [0, 1, 0], up=(1, 0, 0))],
            'notes': 'servo: +Y = output spline axis, origin at spline root on case top; male snap spline_25t (non-standard type; reference only)'}


def rule(ctx):
    sku = ctx['sku']
    rep = []
    rebuild_snaps(ctx, report=rep)
    if sku[:4] in ('5202', '5203', '5204'):
        return motor_rule(ctx, rep)
    if sku[:4] in ('2000', '2002', '2004', '3348'):
        return servo_rule(ctx, rep)
    bore = find_bore(ctx) if sku[:4] in ('1400', '1401', '1302', '1305', '1602', '1605', '1700', '1701', '1702', '1704') else None
    R = thin_axis_frame(ctx, int(np.argmax(np.abs(unit(bore['dir'])))) if bore else None)
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ R.T
    c = (corners.min(0) + corners.max(0)) / 2
    cen = R @ np.array(ctx['centroid'])
    plate_down = sku.startswith('1201-')
    if (cen[1] > c[1]) if plate_down else (cen[1] < c[1]):   # 1201: plate at bottom, posts up; others: heavier side up
        R = np.diag([1, -1, -1.0]) @ R
        corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ R.T
        c = (corners.min(0) + corners.max(0)) / 2
    y0 = corners.min(0)[1]
    if plate_down:  # y=0 on the plate's pattern face (most common downward-facing hole plane)
        ys = [round(float(R.dot(np.array(q['p']))[1]), 2) for q in ctx['snaps'] if (R.dot(np.array(q['n']))[1] < -0.99)]
        if ys:
            from collections import Counter
            y0 = Counter(ys).most_common(1)[0][0] - 0.0
            lowest = min(ys)
            y0 = lowest
    t = np.array([-c[0], -y0, -c[2]])
    if bore:
        bc = R @ np.array(bore['c0'])
        t = np.array([-bc[0], -y0, -bc[2]])
    return {'R': R.tolist(), 't': t.round(5).tolist(), 'male': [], 'notes': 'thinnest bbox axis -> Y, bbox min y=0, xz centred; slot lengths=' + str(sorted(set(rep)))}
