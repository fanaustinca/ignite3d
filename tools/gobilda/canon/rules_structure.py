"""goBILDA STRUCTURE family canonical frames (1101 1102 1103 1106 1109 1116 1117 1120 1121 1126 1127 1137 1139 1143).

Conventions (final frame, Y-up, mm, bbox centred on the origin, axis-aligned R only):
  * U-channels / U-beams (1101, 1120, 1121, 1143): length along X, web at the BOTTOM (-Y), opening toward +Y.
  * Square beams / goRAIL (1106, 1109): length along X; cross-section axes keep the original handedness.
  * Flat beam (1102): length X, thickness Y.  L-beam (1103): length X, corner at (-Y,-Z): horizontal leg flat at the
    bottom, vertical leg standing up at -Z.
  * Grid plates / flat brackets (1116 1117 1127 1139 1126 1137): thinnest axis = Y, longest in-plane axis = X.
The web side of a U-section is found from the material centroid (it sits toward the web).
"""
import numpy as np

PREFIXES = ['1101-', '1102-', '1103-', '1106-', '1109-', '1116-', '1117-', '1120-', '1121-', '1126-', '1127-',
            '1137-', '1139-', '1143-',
            # kit/popular expansion (2026-11-23)
            '1105-', '1123-', '1133-', '2803-', '1206-', '1616-', '1800-', '1801-', '2311-',
            '1111-', '1112-', '1113-', '1147-', '1216-', '1122-', '1118-', '4103-', '1145-']

def _E(i, s=1.0):
    v = np.zeros(3); v[i] = s; return v

def _finish(ctx, rows, notes):
    R = np.array(rows, float)
    if np.linalg.det(R) < 0:
        raise ValueError('left-handed')
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    c = (lo + hi) / 2
    t = -R @ c
    return {'R': R.tolist(), 't': [round(float(x), 6) for x in t], 'male': [], 'notes': notes}

def _from_xy(xv, yv):
    xv, yv = np.array(xv, float), np.array(yv, float)
    return [xv, yv, np.cross(xv, yv)]

def _extent(ctx):
    lo, hi = np.array(ctx['bbox'][0]), np.array(ctx['bbox'][1])
    return hi - lo, (lo + hi) / 2

def _u_channel(ctx):
    ext, ctr = _extent(ctx)
    off = np.array(ctx['centroid']) - ctr
    H = int(np.argmax(np.abs(off)))               # height axis: the centroid shifts toward the web along it
    others = [i for i in range(3) if i != H]
    cnt = {i: 0 for i in others}                  # wall holes run along the width axis, not the length axis
    for h in ctx['holes']:
        a = int(np.argmax(np.abs(h['dir'])))
        if a in cnt and h['r'] > 1.4: cnt[a] += 1
    L = max(others, key=lambda i: (-cnt[i], ext[i]))
    w = _E(H, np.sign(off[H]) or 1.0)             # world direction of the web
    y = -w                                         # web at the bottom
    x = _E(L)
    rows = _from_xy(x, y)
    return _finish(ctx, rows, f'u-channel: length axis {"xyz"[L]}, web toward {"+-"[int(w[H] < 0)]}{"xyz"[H]} -> -Y')

def _slots(ctx):
    """Pair slot end-arc snaps (partial r=2 arcs) on each face; every slot longer than 2 mm (true sliding slot) gets extra
    snaps every 1 mm along its centreline (ids <holeId>s<k>).  Works in place on ctx['snaps'] (STEP frame, before R,t)."""
    sn = ctx['snaps']
    arcs = [s for s in sn if not s.get('full') and s['type'] == 'm4_hole']
    groups = {}
    for s in arcs:
        n = np.array(s['n']); key = (tuple(np.round(n, 3)), round(float(np.dot(s['p'], n)), 2))
        groups.setdefault(key, []).append(s)
    slots = []
    for g in groups.values():
        P = np.array([x['p'] for x in g])
        for i in range(len(g)):
            d = np.linalg.norm(P - P[i], axis=1); d[i] = 1e9
            j = int(np.argmin(d))
            d2 = np.linalg.norm(P - P[j], axis=1); d2[j] = 1e9
            if int(np.argmin(d2)) == i and i < j and d[j] < 8:
                slots.append((g[i], g[j], float(d[j])))
    extra = []
    for a, b, L in slots:
        if L <= 2.0: continue
        pa, pb = np.array(a['p']), np.array(b['p']); u = (pb - pa) / L
        k = 1
        while k < L - 0.3:
            extra.append({**a, 'id': f"{a['holeId']}s{k}{a['id'][-1]}", 'p': (pa + u * k).tolist(), 'full': False, 'slotInterp': True})
            k += 1
    sn.extend(extra)
    ctx['_slots'] = [(a['id'], b['id'], round(L, 3)) for a, b, L in slots]

def _rail(ctx, merge_only_ends=False):
    """goRAIL (1109, 24x24 extrusion) and 1106 square beam: end-face holes are counterbored / modelled-thread holes
    (r2.0 entry, r1.65-1.7 thread) so the detector also sees internal step faces (false) and chamfer-shifted planes.
    Keep only end-direction snaps on the outermost end plane, put them exactly on it, merge the duplicates per hole
    (prefer tapped).  1109: end plane = bbox end (exact).  1106: bbox is fuzzy (thread geometry) so the end plane is the
    outermost snap plane and the part is centred on it.  Side (through) holes of 1106 are kept as detected."""
    ext, ctr = _extent(ctx)
    L = int(np.argmax(ext)); lo, hi = ctr[L] - ext[L] / 2, ctr[L] + ext[L] / 2
    if ctx['sku'][:4] in ('1109', '1118', '4103'):   # tiny 0.25 mm nubs on the end faces inflate the bbox: the true end planes are +-nominal/2
        nom = float(ctx['sku'][-4:]); hi, lo = ctr[L] + nom / 2, ctr[L] - nom / 2
        ctr = ctr.copy(); ext = ext.copy(); ext[L] = nom
    ends = [s for s in ctx['snaps'] if abs(abs(s['n'][L]) - 1) < 1e-6]
    if merge_only_ends and ends:
        hi = max(s['p'][L] for s in ends if s['n'][L] > 0); lo = min(s['p'][L] for s in ends if s['n'][L] < 0)
        nom = float(ctx['sku'][-4:])      # SKU suffix = nominal length; the detector end planes can be 0.05 mm off (chamfers)
        mid = (hi + lo) / 2; hi, lo = mid + nom / 2, mid - nom / 2
        ctr = ctr.copy(); ctr[L] = mid; ext = ext.copy(); ext[L] = nom
    keep = {}
    for s in ctx['snaps']:
        n = np.array(s['n'])
        if abs(abs(n[L]) - 1) > 1e-6:
            if merge_only_ends:   # 1106 side through-holes: drop the internal faces where they cross the central axial bore
                ax = int(np.argmax(np.abs(n)))
                if ctx['sku'][:4] == '1145':
                    # 8 x 8 mm threaded beam: every cross hole is tapped through; thread chamfers start ~0.05 mm inside
                    # the face and the OCC bbox is inflated, so snap the outer segment ends onto the true +-4 mm faces
                    if abs(s['p'][ax] - ctr[ax]) >= 3.5 and np.sign(n[ax]) == np.sign(s['p'][ax] - ctr[ax]):
                        p = list(s['p']); p[ax] = ctr[ax] + np.sign(n[ax]) * 4.0
                        key = ('side', ax, int(np.sign(n[ax])), round(p[L] * 2), round(p[3 - L - ax] * 2))
                        keep[key] = {**s, 'p': p, 'depth': 8.0, 'tapped': True, 'type': 'm4_hole'}
                elif abs(s['p'][ax] - ctr[ax]) >= ext[ax] / 2 - 0.1: keep[('side', s['id'])] = s
            continue
        end = hi if n[L] > 0 else lo
        if abs(s['p'][L] - end) > 0.7: continue
        p = list(s['p']); p[L] = end
        key = (round(p[(L + 1) % 3] * 2), round(p[(L + 2) % 3] * 2), int(n[L]), s['type'])   # r2.0 entry / r1.65-1.7 thread centres differ by up to 0.1
        new = {**s, 'p': p, 'depth': float(ext[L]), 'tapped': bool(s['tapped'] or s['type'] == 'm4_hole')}
        if key in keep:
            old_ = keep[key]
            dev = lambda q: sum(abs(q['p'][i] - round(q['p'][i])) for i in ((L + 1) % 3, (L + 2) % 3))
            best = new if dev(new) < dev(old_) - 1e-9 else old_   # keep the centre that sits on the 8 mm grid
            best = {**best, 'tapped': bool(old_['tapped'] or new['tapped'])}
            keep[key] = best
        else: keep[key] = new
    ctx['snaps'][:] = list(keep.values())
    cyc = [_E(L), _E((L + 1) % 3), _E((L + 2) % 3)]   # cyclic permutation: length -> X, det = +1
    c2 = np.array(ctx['bbox'][0]) * 0 + ctr
    ctx = {**ctx, 'bbox': [list(c2 - ext / 2), list(c2 + ext / 2)]}
    return _finish(ctx, cyc, f'rail/beam: length axis {"xyz"[L]} -> X; end-face snaps merged onto the end planes')

def _flat(ctx):
    """Beams/plates with one thin axis: thin -> Y, longest in-plane axis -> X, third -> Z (right-handed)."""
    ext, ctr = _extent(ctx)
    T = int(np.argmin(ext))
    inpl = [i for i in range(3) if i != T]
    L = max(inpl, key=lambda i: (ext[i], -i))
    x, y = _E(L), _E(T)
    return _finish(ctx, _from_xy(x, y), f'flat: thin axis {"xyz"[T]} -> Y, long axis {"xyz"[L]} -> X')

def _lbeam(ctx):
    """L-beam: the two axes along which the centroid is shifted are the leg directions (shift points to the corner).
    Corner goes to (-Y,-Z): flat leg lies on the bottom, the other leg stands up along +Y at -Z."""
    ext, ctr = _extent(ctx)
    off = np.array(ctx['centroid']) - ctr
    L = int(np.argmin(np.abs(off)))
    A, B = [i for i in range(3) if i != L]
    y = _E(A, -np.sign(off[A])); z = _E(B, -np.sign(off[B]))
    x = np.cross(y, z)
    return _finish(ctx, [x, y, z], f'L-beam: length axis {"xyz"[L]} -> X, corner -> (-Y,-Z)')

def rule(ctx):
    p = ctx['sku'][:4]
    if p in ('1102', '1116', '1117', '1126', '1127', '1137', '1139', '1105', '1123', '1133', '2803', '1206', '1616', '1800', '1801', '2311'):
        _slots(ctx); return _flat(ctx)
    if p in ('1103', '1111', '1112', '1113', '1147', '1216'):
        _slots(ctx); return _lbeam(ctx)
    if p in ('1109', '1106', '1118', '4103', '1145'):
        return _rail(ctx, merge_only_ends=(p in ('1106', '1145')))
    _slots(ctx)
    p = ctx['sku'][:4]
    if p in ('1101', '1120', '1121', '1143', '1122'):
        return _u_channel(ctx)
    return None
