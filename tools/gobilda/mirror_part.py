"""Make the chiral partner of a converted part (mecanum wheels ship as one hand per STEP).

python mirror_part.py SRC NEW "New title"   -> out/NEW.{glb,draco.glb,json,step.json}, overrides/NEW.json, parts.json entry
Mirror plane = the part frame's YZ plane (x -> -x); mesh, snaps, male snaps and the exact B-rep are all mirrored.
"""
import json, os, struct, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
D = os.path.dirname(os.path.abspath(__file__))
Y = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
mx = lambda v: [-v[0], v[1], v[2]]

def mirror_glb(src, dst):
    b = bytearray(open(src, 'rb').read())
    n = struct.unpack('<I', b[12:16])[0]
    js = json.loads(b[20:20 + n]); base = 20 + n + 8
    for m in js['meshes']:
        for pr in m['primitives']:
            for key in ('POSITION', 'NORMAL'):
                acc = js['accessors'][pr['attributes'][key]]; bv = js['bufferViews'][acc['bufferView']]
                off = base + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
                a = np.frombuffer(bytes(b[off: off + acc['count'] * 12]), '<f4').reshape(-1, 3).copy(); a[:, 0] *= -1
                b[off: off + acc['count'] * 12] = a.tobytes()
                if 'min' in acc:
                    lo, hi = acc['min'], acc['max']; acc['min'], acc['max'] = [-hi[0], lo[1], lo[2]], [-lo[0], hi[1], hi[2]]
            acc = js['accessors'][pr['indices']]; bv = js['bufferViews'][acc['bufferView']]
            off = base + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
            dt = {5125: '<u4', 5123: '<u2'}[acc['componentType']]; sz = np.dtype(dt).itemsize
            ii = np.frombuffer(bytes(b[off: off + acc['count'] * sz]), dt).reshape(-1, 3)[:, [0, 2, 1]].copy()
            b[off: off + acc['count'] * sz] = ii.tobytes()
    a0 = js['accessors'][0]
    if 'min' in a0:  # accessor 0 carries whole-part bounds in our GLBs: recompute from all positions
        pass
    nj = json.dumps(js, separators=(',', ':')).encode(); nj += b' ' * ((4 - len(nj) % 4) % 4)
    old_js_len = n
    rest = bytes(b[20 + old_js_len:])
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(nj) + len(rest)) + struct.pack('<II', len(nj), 0x4E4F534A) + nj + rest
    open(dst, 'wb').write(out)

def snap(s):
    s = dict(s)
    for k in ('p', 'n', 'position', 'normal', 'upVector', 'up'):
        if s.get(k) is not None: s[k] = mx(s[k])
    return s

def main(src, new, title):
    meta = json.load(open(f'{D}/out/{src}.json'))
    mirror_glb(f'{D}/out/{src}.glb', f'{D}/out/{new}.glb')
    # whole-part bounds on accessor 0: union over all position accessors
    b = open(f'{D}/out/{new}.glb', 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + n])
    los = [js['accessors'][p['attributes']['POSITION']]['min'] for m in js['meshes'] for p in m['primitives']]
    his = [js['accessors'][p['attributes']['POSITION']]['max'] for m in js['meshes'] for p in m['primitives']]
    js['accessors'][0]['min'] = np.min(los, 0).tolist(); js['accessors'][0]['max'] = np.max(his, 0).tolist()
    nj = json.dumps(js, separators=(',', ':')).encode(); nj += b' ' * ((4 - len(nj) % 4) % 4); rest = b[20 + n:]
    open(f'{D}/out/{new}.glb', 'wb').write(struct.pack('<III', 0x46546C67, 2, 20 + len(nj) + len(rest)) + struct.pack('<II', len(nj), 0x4E4F534A) + nj + rest)
    r = subprocess.run(['npx', 'gltf-transform', 'draco', f'{D}/out/{new}.glb', f'{D}/out/{new}.draco.glb'], capture_output=True, text=True, cwd=D)
    lo, hi = meta['bbox']
    m2 = {**meta, 'sku': new, 'mirrorOf': src, 'snaps': [snap(s) for s in meta['snaps']], 'male': [snap(s) for s in meta.get('male') or []],
          'centroid': mx(meta['centroid']), 'bbox': [[-hi[0], lo[1], lo[2]], [-lo[0], hi[1], hi[2]]],
          'bosses': [{**q, 'c0': mx(q['c0']), 'c1': mx(q['c1']), 'dir': mx(q['dir'])} for q in meta.get('bosses', [])]}
    json.dump(m2, open(f'{D}/out/{new}.json', 'w'))
    ov = f'{D}/overrides/{src}.json'
    if os.path.exists(ov):
        o = json.load(open(ov))
        for k in ('addSnaps', 'male'):
            if k in o: o[k] = [snap(s) for s in o[k]]
        o['notes'] = f'mirror of {src}. ' + o.get('notes', '')
        json.dump(o, open(f'{D}/overrides/{new}.json', 'w'), indent=1)
    # exact B-rep: reflect in STEP coordinates through the plane that maps to the part frame's x = 0
    from extract import load
    from convert import step_fragment
    from OCC.Core.gp import gp_Trsf, gp_Ax2, gp_Pnt, gp_Dir
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
    R, t = np.array(meta['R'], float), np.array(meta['t'], float); M = R @ Y
    nrm = M.T @ np.array([1.0, 0, 0])
    # part x = (M p + t)_x = 0 plane in STEP coords: nrm . p = -t_x
    p0 = nrm * (-t[0])
    tr = gp_Trsf(); tr.SetMirror(gp_Ax2(gp_Pnt(*p0), gp_Dir(*nrm)))
    shape = BRepBuilderAPI_Transform(load(f'{D}/step/{src}.STEP'), tr, True).Shape()
    json.dump(step_fragment(shape, M, t, new, title), open(f'{D}/out/{new}.step.json', 'w'))
    parts = json.load(open(f'{D}/parts.json'))
    parts[new] = {**parts[src], 'sku': new, 'title': title, 'mirrorOf': src}
    json.dump(parts, open(f'{D}/parts.json', 'w'), indent=1)
    w = json.load(open(f'{D}/weights.json'))
    if src in w: w[new] = w[src]; json.dump(w, open(f'{D}/weights.json', 'w'), indent=1)
    print(new, 'mirrored from', src, 'draco', r.returncode)

if __name__ == '__main__':
    main(*sys.argv[1:4])
