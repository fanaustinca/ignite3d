"""Convert one goBILDA STEP into Ignite3D assets.

python convert.py SKU [--proc procedural.json]
  in : step/{SKU}.STEP (unzipped)
  out: out/{SKU}.glb           mesh in Ignite3D part frame (mm, Y-up), uncompressed (Draco pass runs after)
       out/{SKU}.json          real snaps (registered), bbox, volume, centroid, registration report, bosses
       out/{SKU}.step.json     STEP fragment in the same part frame for Onshape export splicing
"""
import json, os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import extract, tessellate, write_glb, to_yup
from register import snaps_from_holes, register, apply
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.gp import gp_Trsf
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCC.Core.Interface import Interface_Static

D = os.path.dirname(os.path.abspath(__file__))
Y = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)  # STEP Z-up -> Y-up

def step_fragment(shape, M, t, sku, name):
    """Transform the B-rep into the part frame and return a spliceable STEP DATA fragment."""
    tr = gp_Trsf()
    tr.SetValues(*M[0], t[0], *M[1], t[1], *M[2], t[2])
    moved = BRepBuilderAPI_Transform(shape, tr, True).Shape()
    Interface_Static.SetCVal('write.step.schema', 'AP214IS')
    Interface_Static.SetCVal('write.step.unit', 'MM')
    Interface_Static.SetCVal('write.step.product.name', f'{sku} {name}'[:120])
    w = STEPControl_Writer()
    w.Transfer(moved, STEPControl_AsIs)
    tmp = os.path.join(D, 'out', f'{sku}.tmp.step')
    w.Write(tmp)
    txt = open(tmp, encoding='latin-1').read()
    os.remove(tmp)
    data = txt[txt.index('DATA;') + 5: txt.rindex('ENDSEC;')].strip()
    ents = {}
    for m in re.finditer(r'#(\d+)\s*=\s*(.*?);\s*(?=#\d+\s*=|$)', data, re.S):
        ents[int(m.group(1))] = m.group(2)
    pd = next(i for i, e in ents.items() if e.startswith('PRODUCT_DEFINITION('))
    sdr = next(e for e in ents.values() if e.startswith('SHAPE_DEFINITION_REPRESENTATION('))
    rep = int(re.findall(r'#(\d+)', sdr)[1])
    items = re.findall(r'#(\d+)', ents[rep])
    origin = next(int(i) for i in items if ents.get(int(i), '').startswith('AXIS2_PLACEMENT_3D('))
    return {'sku': sku, 'maxId': max(ents), 'pd': pd, 'rep': rep, 'origin': origin, 'data': data}

def main(sku, proc_path):
    os.makedirs(os.path.join(D, 'out'), exist_ok=True)
    path = os.path.join(D, 'step', f'{sku}.STEP')
    d, shape = extract(path)
    g = GProp_GProps(); brepgprop.VolumeProperties(shape, g); c = g.CentreOfMass()
    centroid = to_yup((c.X(), c.Y(), c.Z()))
    snaps = snaps_from_holes(d['holes'])
    proc = json.load(open(proc_path)).get(sku) if proc_path and os.path.exists(proc_path) else None
    lo, hi = np.array(d['bbox'][0]), np.array(d['bbox'][1])
    parts = json.load(open(os.path.join(D, 'parts.json')))
    from canon import find_rule
    mod = find_rule(sku)
    ruled = None
    if mod:
        ctx = {'sku': sku, 'title': parts.get(sku, {}).get('title', sku), 'bbox': d['bbox'], 'centroid': centroid.tolist(),
               'volume_mm3': d['volume'], 'holes': d['holes'], 'bosses': d['bosses'], 'snaps': snaps}
        ruled = mod.rule(ctx)
    male = []
    if ruled:
        R, t = np.array(ruled['R'], float), np.array(ruled['t'], float)
        male = ruled.get('male', [])
        rep = {'frame': f'rule {mod.__name__}', 'notes': ruled.get('notes', '')}
        if proc:  # cross-check against the procedural model when one exists
            from register import match_count
            A = np.array([s_['p'] for s_ in apply(R, t, snaps)]) if snaps else np.zeros((0, 3))
            An = np.array([s_['n'] for s_ in apply(R, t, snaps)]) if snaps else np.zeros((0, 3))
            PP = np.array([q['p'] for q in proc['female']]) if proc['female'] else np.zeros((0, 3))
            PN = np.array([q['n'] for q in proc['female']]) if proc['female'] else np.zeros((0, 3))
            rep['procedural_matched_faces'] = match_count(A, An, PP, PN)[0] if len(A) and len(PP) else 0
    elif proc:
        R, t, rep = register({'bbox': d['bbox'], 'centroid': centroid.tolist(), 'snaps': snaps}, proc)
        rep['frame'] = 'registered-to-procedural'
    else:
        R, t = np.eye(3), -(lo + hi) / 2
        rep = {'frame': 'bbox-centred (no procedural model)'}
    # full transform from STEP file coords: x' = R (Y x) + t
    M = R @ Y
    P, I = tessellate(shape)
    P = (P.astype(float) @ R.T + t).astype(np.float32)
    write_glb(os.path.join(D, 'out', f'{sku}.glb'), P, I)
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]) @ R.T + t
    out = {
        'sku': sku, 'R': R.tolist(), 't': np.round(t, 5).tolist(), 'registration': rep,
        'volume_mm3': round(d['volume'], 2), 'centroid': np.round(R @ centroid + t, 4).tolist(),
        'bbox': [corners.min(0).round(4).tolist(), corners.max(0).round(4).tolist()],
        'snaps': apply(R, t, snaps),
        'bosses': [{**b, 'c0': (R @ np.array(b['c0']) + t).round(4).tolist(), 'c1': (R @ np.array(b['c1']) + t).round(4).tolist(),
                    'dir': (R @ np.array(b['dir'])).round(6).tolist()} for b in d['bosses']],
        'holes_raw': len(d['holes']), 'solids': d['solids'], 'tris': int(len(I)), 'male': male,
    }
    json.dump(out, open(os.path.join(D, 'out', f'{sku}.json'), 'w'))
    frag = step_fragment(shape, M, t, sku, proc['name'] if proc else sku)
    json.dump(frag, open(os.path.join(D, 'out', f'{sku}.step.json'), 'w'))
    print(json.dumps({'sku': sku, **rep, 'snaps': len(out['snaps']), 'tris': out['tris']}))

if __name__ == '__main__':
    proc = sys.argv[sys.argv.index('--proc') + 1] if '--proc' in sys.argv else os.path.join(D, 'procedural.json')
    main(sys.argv[1], proc)
