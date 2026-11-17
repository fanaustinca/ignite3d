"""Generate overrides/*.json for the power_transmission family from out/*.json (run AFTER batch.py, with the occt python).
  ~/miniforge3/envs/occt/bin/python pt_overrides.py [SKU ...]
Why: the detector (register.snaps_from_holes) (a) emits seam-split / thread-step duplicates, (b) cannot see REX hex bores
(they are planar faceted in the real STEP: no cylinder faces), (c) mistypes e-clip grooves as rex_8mm, (d) cannot know hub threads.
This script normalises per family: one snap per hole face (outermost), merged depth, bore snaps from the SKU bore code,
hub_pattern_16mm for hubs, tapped for shaft-end / set-screw holes."""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
D = os.path.dirname(os.path.abspath(__file__))
SHAFT = ('2101-', '2102-', '2106-', '2109-')
HUB = ('1309-', '1310-')
BORE_CODE = {'4008': 'rex_8mm', '0008': 'rex_8mm', '1006': 'd_6mm', '0006': 'd_6mm', '0014': 'bearing_14mm'}
# 2312 / 4005 / 3204 / 2302-0032 / 2303-0125 resolved below

def tight(sku, d):
    from extract import load, tessellate
    P, _ = tessellate(load(os.path.join(D, 'step', f'{sku}.STEP')))
    Q = P @ np.array(d['R']).T + np.array(d['t'])
    return Q

def orient(Q, ylo, yhi, kind, convex):
    """Angle phi (rad, from +X toward +Z) of the REX hex corner (kind='hex') or the D flat normal (kind='d') of the bore (concave)
    or shaft (convex) section between ylo and yhi, from the mesh."""
    r = np.hypot(Q[:, 0], Q[:, 2]); m = (Q[:, 1] > ylo) & (Q[:, 1] < yhi)
    if kind == 'hex':
        m &= (r > 3.3) & (r < 4.1)
        th = np.arctan2(Q[m, 2], Q[m, 0]); rr = r[m]
        if m.sum() < 6: return None
        z = ((rr - 3.4) ** 2 * np.exp(6j * th)).sum()      # 6-fold phase weighted toward the corners
        return float(np.angle(z) / 6)
    m &= (r > 2.95) & (r < 3.15)          # D flat = centre of the largest angular gap in the round part of the profile
    if m.sum() < 6: return None
    th = np.sort(np.arctan2(Q[m, 2], Q[m, 0]))
    gaps = np.diff(np.concatenate([th, [th[0] + 2 * np.pi]]))
    i = int(np.argmax(gaps))
    return float(th[i] + gaps[i] / 2)

def merge_lines(snaps):
    """Union overlapping/touching hole segments on a common axis line (seam splits, tap-drill vs clearance steps);
    emit one snap per open outer end with the union depth. Oblique holes: keep the outermost end only."""
    lines = {}
    out = []
    obl = {}
    for s in snaps:
        n = np.array(s['n'], float); p = np.array(s['p'], float)
        k = int(np.argmax(np.abs(n)))
        if abs(abs(n[k]) - 1) > 1e-3:
            obl.setdefault((tuple(np.round(n, 2)), round(float(np.cross(n, p)[1]) * 2) / 2), []).append(s); continue
        perp = tuple(np.round(np.delete(p, k), 1))
        lines.setdefault((k, perp), {}).setdefault(s['holeId'], []).append(s)
    for hs in obl.values():
        out.append(dict(max(hs, key=lambda s: float(np.dot(s['n'][:3], s['p'])))))
    for (k, perp), holes in lines.items():
        segs = []
        for hid, ss in holes.items():
            s0 = ss[0]; sg = np.sign(s0['n'][k]); t = s0['p'][k]
            t2 = t - sg * s0['depth']
            segs.append([min(t, t2), max(t, t2), ss])
        segs.sort(key=lambda x: x[0])
        comps = []
        for lo, hi, ss in segs:
            if comps and lo <= comps[-1][1] + 0.05:
                comps[-1][1] = max(comps[-1][1], hi); comps[-1][2] += ss
            else:
                comps.append([lo, hi, list(ss)])
        for lo, hi, ss in comps:
            tap = any(x['tapped'] for x in ss)
            for t_end, sg in ((lo, -1), (hi, 1)):
                c = [x for x in ss if np.sign(x['n'][k]) == sg and abs(x['p'][k] - t_end) < 0.7]
                if not c: continue
                best = min(c, key=lambda x: abs(x['p'][k] - t_end))
                new = dict(best); new['depth'] = round(hi - lo, 3); new['tapped'] = tap
                new['p'] = list(best['p']); new['p'][k] = round(t_end, 4)
                out.append(new)
    return out

def bore_type(sku, title):
    p = sku.split('-')
    if sku.startswith('3204-'):
        return 'd_6mm' if 'D-Bore' in title else 'rex_8mm' if 'REX' in title else None
    if sku.startswith('2312-'): return 'bearing_14mm'
    t = {'4008': 'rex_8mm', '0008': 'rex_8mm', '1006': 'd_6mm', '0006': 'd_6mm', '0014': 'bearing_14mm'}
    return t.get(p[1]) or t.get(p[2])

def gen(sku, d):
    ov = {}
    snaps = d['snaps']
    if sku.startswith(SHAFT):
        L2 = d['male'][1]['position'][1] if d.get('male') else abs(d['bbox'][1][1]) 
        rm, fix = [], {}
        for s in snaps:
            ok = s['type'] == 'm4_hole' and abs(abs(s['p'][1]) - L2) < 0.05 and abs(s['n'][1]) > 0.99 and np.sign(s['n'][1]) == np.sign(s['p'][1]) and np.hypot(s['p'][0], s['p'][2]) < 0.05
            if ok: fix[s['id']] = True
            else: rm.append(s['id'])
        up = None
        typ = d['male'][0]['type'] if d.get('male') else None
        if typ in ('rex_8mm', 'd_6mm'):
            Qs = tight(sku, d)
            phi = orient(Qs, -L2 - 0.05, L2 + 0.05, 'hex' if typ == 'rex_8mm' else 'd', True)
            if phi is not None: up = [round(float(np.cos(phi)), 5), 0.0, round(float(np.sin(phi)), 5)]
        if up:
            d['male'] = [dict(m, upVector=up) for m in d['male']]
        return {'removeSnapIds': rm, 'tappedFix': fix, 'notes': 'shaft: M4-tapped axial hole at each end face kept; thread-end faces / e-clip groove (false rex) removed'}
    Q = tight(sku, d)
    y0, y1 = float(Q[:, 1].min()), float(Q[:, 1].max()); L = y1 - y0
    title = json.load(open(os.path.join(D, 'parts.json')))[sku]['title']
    bt = bore_type(sku, title)
    centre = [s for s in snaps if np.hypot(s['p'][0], s['p'][2]) < 0.05 and abs(s['n'][1]) > 0.99] if not sku.startswith('4005-') else []
    rest = [s for s in snaps if s not in centre]
    new = merge_lines(rest)
    for s in new:
        n = np.array(s['n']); p = np.array(s['p'])
        radial = abs(n[1]) < 0.5
        if radial and np.dot(n[[0, 2]], p[[0, 2]]) <= 0:   # inner end of a set-screw hole opens into the bore: drop
            s['_drop'] = True
    new = [s for s in new if not s.get('_drop')]
    if sku.startswith(HUB):
        for s in new:
            axial = abs(s['n'][1]) > 0.99
            pat = axial and abs(abs(s['p'][0]) - 8) < 0.3 and abs(abs(s['p'][2]) - 8) < 0.3
            if pat: s['type'] = 'hub_pattern_16mm'; s['tapped'] = True
            elif not axial: s['tapped'] = True
    elif not sku.startswith('1611-') and not sku.startswith('1600-') and not sku.startswith('2910-'):
        for s in new:
            if abs(s['n'][1]) < 0.5: s['tapped'] = True      # set-screw holes
    if sku.startswith(('2910-',)):
        for s in new: s['tapped'] = True if abs(s['n'][1]) < 0.5 else s['tapped']
    adds = []
    if bt:
        rb = {'rex_8mm': 4.15, 'd_6mm': 3.05, 'bearing_14mm': 7.05}[bt]
        rr = np.hypot(Q[:, 0], Q[:, 2])
        m = (rr <= rb) & (rr >= rb - 0.8)
        if m.sum() > 8:
            by0, by1 = float(Q[m, 1].min()), float(Q[m, 1].max())
        else:
            by0, by1 = y0, y1
        if by0 - y0 < 0.6: by0 = y0        # chamfer/countersink at the bore mouth hides the true face
        if y1 - by1 < 0.6: by1 = y1
        bL = by1 - by0
        for i, (y, ny) in enumerate(((by0, -1), (by1, 1))):
            phi = orient(Q, by0 - 0.05, by1 + 0.05, 'hex' if bt == 'rex_8mm' else 'd', False) if bt in ('rex_8mm', 'd_6mm') else None
            upd = {'up': [round(float(np.cos(phi)), 5), 0.0, round(float(np.sin(phi)), 5)]} if phi is not None else {}
            adds.append({**upd, 'id': f'bore{"ab"[i]}', 'type': bt, 'p': [0.0, round(y, 4), 0.0], 'n': [0.0, ny, 0.0], 'depth': round(bL, 3), 'tapped': False, 'holeId': 'bore', 'full': True})
    ids_new = []
    for j, s in enumerate(new):
        s = {k: v for k, v in s.items() if not k.startswith('_')}
        s['id'] = 'm' + s['id']; adds.append(s)
    ov = {'removeSnapIds': [s['id'] for s in snaps], 'addSnaps': adds,
          'notes': f'normalised: seam/thread duplicates merged to outermost face; bore {bt or "untyped"} added from SKU bore code (REX hex bores are not cylinders in the STEP); part y span {y0:.2f}..{y1:.2f}'}
    return ov

def main():
    from canon.rules_power_transmission import PREFIXES
    skus = sys.argv[1:] or sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(D, 'out', '*.json')) if not f.endswith('.step.json'))
    for sku in skus:
        if not sku.startswith(tuple(PREFIXES)): continue
        d = json.load(open(os.path.join(D, 'out', f'{sku}.json')))
        if sku.startswith('3204-'):
            json.dump({'exclude': True, 'notes': 'two meshed bevel gears + hardware in one STEP (5 solids, perpendicular axes); not a single part, needs splitting into pinion + gear'}, open(os.path.join(D, 'overrides', f'{sku}.json'), 'w')); print('excluded', sku); continue
        ov = gen(sku, d)
        if d.get('male'): ov['male'] = d['male']   # viewer/fitcheck read male snaps only from overrides
        if sku.startswith('1611-'):
            pass
        json.dump(ov, open(os.path.join(D, 'overrides', f'{sku}.json'), 'w'), indent=1)
        print('override', sku, 'rm', len(ov['removeSnapIds']), 'add', len(ov.get('addSnaps', [])))
main()
