"""goBILDA fasteners & spacers (screws, nuts, washers, shims, spacers, standoffs, hole reducer)."""
import numpy as np
from .lib import unit, frame, snap_axis, male, longest_axis

PREFIXES = ['2800-', '2802-', '2811-', '2812-', '2801-', '2810-', '2807-', '1500-', '1520-', '1526-',
            '1501-', '1516-', '1523-', '1504-', '1505-', '1506-', '1517-', '1531-', '2904-',
            # kit/popular expansion (2026-11-23)
            '1502-', '1503-', '1514-', '1521-', '1522-', '1529-', '1530-', '3900-', '2804-', '2813-', '2822-', '2806-',
            '2809-', '2805-', '2816-',
            # round 5: threaded rods, ball linkages, offset standoffs
            '2808-', '2903-', '2913-', '1513-']

def _ax(b):
    return unit(b['dir'])

def _proj(p, a):
    return float(np.dot(p, a))

def _screw(ctx):
    bs = ctx['bosses']
    head = max(bs, key=lambda b: b['r'])
    a = _ax(head)
    # shank = largest-r boss that is not the head and is coaxial
    sh = [b for b in bs if b is not head and abs(abs(np.dot(_ax(b), a)) - 1) < 1e-4]
    shank = max(sh, key=lambda b: b['r'])
    hc = (np.array(head['c0']) + np.array(head['c1'])) / 2
    if ctx['sku'].startswith('2822-'):
        # premium screws: the blue thread-lock patch is a second coaxial solid (r ~ shank r) partway down the thread;
        # the real shank is the coaxial M4 boss whose end meets the head
        hend = lambda b: min(np.linalg.norm(np.array(b[k]) - np.array(head[j])) for k in ('c0', 'c1') for j in ('c0', 'c1'))
        m4 = [b for b in sh if 1.6 <= b['r'] <= 2.1]
        shank = min(m4 or sh, key=lambda b: (round(hend(b), 1), -b['r']))
    sc = (np.array(shank['c0']) + np.array(shank['c1'])) / 2
    h = unit(a * (1 if np.dot(hc - sc, a) > 0 else -1))        # direction shank -> head
    # under-head plane = end of shank boss nearest the head
    ends = [np.array(shank['c0']), np.array(shank['c1'])]
    uh = max(ends, key=lambda p: np.dot(p, h))
    R = snap_axis(frame(h))
    t = -R @ uh
    lo, hi = _ext(ctx, R, t)
    notes = (f"screw: head=largest-r boss (r={head['r']:.2f}), under-head plane at shank start, axis through origin, head +Y. "
             f"measured (mesh) shank underhead->tip {-lo[1]:.3f} mm, head height {hi[1]:.3f} mm, head r={head['r']:.2f}")
    return {'R': R.tolist(), 't': t.tolist(),
            'male': [male('underhead', 'm4_hole', (0, 0, 0), (0, -1, 0))], 'notes': notes}

_MESH = {}
def _mesh(sku):
    """Tessellated vertices (Y-up, pre-canonical). The BRep bbox in ctx is padded by tolerance (up to ~0.3 mm),
    so true extents are measured on the mesh."""
    if sku not in _MESH:
        import os
        from extract import load, tessellate, to_yup
        sh = load(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'step', f'{sku}.STEP'))
        P, _ = tessellate(sh)
        _MESH[sku] = P.astype(float)
    return _MESH[sku]

def _ext(ctx, R, t):
    Q = _mesh(ctx['sku']) @ np.asarray(R).T + t
    return Q.min(0), Q.max(0)

def _nut(ctx):
    P = _mesh(ctx['sku'])
    # axis = direction of the tapped/through bore
    hs = [h for h in ctx['holes'] if h.get('full')]
    a = unit(max(hs, key=lambda h: h['len'])['dir']) if hs else longest_axis(ctx)
    a = np.round(a)  # axis-aligned in STEP
    o = [i for i in range(3) if abs(a[i]) < 0.5]
    z = P @ a
    r = np.hypot(P[:, o[0]], P[:, o[1]])
    zlo, zhi = z.min(), z.max()
    tol = 0.02
    rlo = r[z < zlo + tol].max(); rhi = r[z > zhi - tol].max()
    # flat bearing face = the end whose end plane has the larger outer radius (dome / nylon end is smaller)
    flat_lo = rlo >= rhi
    s = 1.0 if flat_lo else -1.0          # direction flat -> dome
    d = unit(a * s)
    z0 = zlo if flat_lo else zhi
    R = snap_axis(frame(d))
    # axis through origin: use bore centre (hole c0 xz); project point on axis at z0
    c = np.array(hs[0]['c0']) if hs else np.zeros(3)
    pt = c - a * np.dot(c, a) + a * z0
    t = -R @ pt
    lo, hi = _ext(ctx, R, t)
    H = float(hi[1] - lo[1])
    return {'R': R.tolist(), 't': t.tolist(), 'male': [],
            'notes': f'nut: axis Y, flat bearing face (end-plane r={max(rlo, rhi):.2f}) at y=0, body +Y, total height {H:.3f} mm '
                     f'(mesh y {lo[1]:.3f}..{hi[1]:.3f}); other end r={min(rlo, rhi):.2f}'}

def _disc(ctx):
    """Washers / shims / spacers / standoffs / pattern spacers / hole reducer: axis -> Y.
    Centred on the mesh extent along the axis (2904: flange underside at y=0, spigot toward -Y)."""
    sku = ctx['sku']
    full = [b for b in ctx['bosses'] if b.get('full')]
    if full or ctx['bosses']:
        big = max(full or ctx['bosses'], key=lambda b: b['r'])
        a = unit(big['dir'])
        cen = np.array(big['c0']) if full else np.zeros(3)
    else:
        # split-lock washers / goRAIL hurricane nuts: no full outer cylinder -> axis of the largest full hole
        # (the M4 bore), else the thinnest bbox axis; centred on that hole
        hs = [h for h in ctx['holes'] if h.get('full')]
        if hs:
            hb = max(hs, key=lambda h: (h['r'] < 2.5, h['len']))
            a = unit(hb['dir']); cen = np.array(hb['c0'], float)
        else:
            a = longest_axis(ctx) * 0 + np.eye(3)[int(np.argmin(np.array(ctx['bbox'][1]) - np.array(ctx['bbox'][0])))]
            cen = (np.array(ctx['bbox'][0]) + np.array(ctx['bbox'][1])) / 2
        big = {'r': 0.0}
    cen = cen - a * np.dot(cen, a)
    P = _mesh(sku)
    z = P @ a
    zlo, zhi = z.min(), z.max()
    if sku.startswith('2904-'):
        # flange = large-r boss (r=7.8); spigot (r=7.0) is the part inserted into the 14 mm bore
        fl = max(ctx['bosses'], key=lambda b: b['r'])
        fz = (np.dot(fl['c0'], a) + np.dot(fl['c1'], a)) / 2
        sg = min([b for b in ctx['bosses'] if b['r'] < fl['r'] - 0.1], key=lambda b: -b['r'])
        sz = (np.dot(sg['c0'], a) + np.dot(sg['c1'], a)) / 2
        d = unit(a * (1 if fz > sz else -1))          # spigot -> flange direction becomes +Y
        R = snap_axis(frame(d))
        # underside plane = where flange begins on the spigot side
        zu = min(np.dot(fl['c0'], d), np.dot(fl['c1'], d))
        pt = cen + d * zu
        t = -R @ pt
        lo, hi = _ext(ctx, R, t)
        return {'R': R.tolist(), 't': t.tolist(),
                'male': [male('flange_underside', 'bearing_14mm', (0, 0, 0), (0, -1, 0))],
                'notes': f'hole reducer: flange underside at y=0 (flange r={fl["r"]}), spigot r={sg["r"]} toward -Y '
                         f'(mesh y {lo[1]:.3f}..{hi[1]:.3f}); male bearing_14mm normal (0,-1,0) = insertion into the bore'}
    if sku.startswith('1523-'):
        # STEP is an assembly (standoff + 2 screws + 2 other parts) away from the origin: centre on the standoff body,
        # i.e. the extent of its threaded end holes, on the axis of those holes.
        hh = [h for h in ctx['holes'] if abs(h['r'] - 2.0) < 1e-3 and h.get('full')]
        cen = np.array(hh[0]['c0']); cen = cen - a * np.dot(cen, a)
        zs = [np.dot(h[k], a) for h in hh for k in ('c0', 'c1')]
        zlo, zhi = min(zs) - 0.0, max(zs) + 0.0
    R = snap_axis(frame(a))
    mid = (zlo + zhi) / 2
    t = -R @ (cen + a * mid)
    lo, hi = _ext(ctx, R, t)
    if sku.startswith('1523-'):
        extra0 = ' ASSEMBLY STEP (standoff + 2 screws + 2 other bodies; mesh extent includes screws) - excluded'
    else:
        extra0 = ''
    extra = ''
    if sku.startswith('1516-'):
        extra = ' REX outer profile: REX hex bore-less body: hexagon 7.0 mm across flats with corners turned to 8.0 mm dia (r=4.0 arcs), M4 threaded both ends'
    return {'R': R.tolist(), 't': t.tolist(), 'male': [],
            'notes': f'axis Y, centred (mesh y {lo[1]:.3f}..{hi[1]:.3f}, length {hi[1]-lo[1]:.3f}, max r {big["r"]}).' + extra0 + extra}

def rule(ctx):
    sku = ctx['sku']
    if sku.startswith(('2801-', '2810-', '2807-', '1500-', '1520-', '1526-', '1501-', '1516-', '1523-', '1504-', '1505-', '1506-', '1517-', '1531-', '2904-',
                       '1502-', '1503-', '1514-', '1521-', '1522-', '1529-', '1530-', '3900-', '2806-', '2809-', '2805-', '2816-',
                       '2808-', '2903-', '2913-', '1513-')):
        return _disc(ctx)
    if sku.startswith(('2800-', '2802-', '2804-', '2813-', '2822-')):
        return _screw(ctx)
    if sku.startswith(('2811-', '2812-')):
        return _nut(ctx)
    return None
