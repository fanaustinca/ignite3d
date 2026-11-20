"""Re-mesh multi-body goBILDA parts with real colours per sub-part (by STEP product name).

python recolor.py SKU [SKU ...]   -> rewrites out/{SKU}.glb (+ .draco.glb) with one material per colour.
The geometry and part frame are identical to convert.py (same tessellation, same R/t from out/{SKU}.json).
"""
import json, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import tessellate
from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
from OCC.Core.TDF import TDF_LabelSequence
from OCC.Core.TDataStd import TDataStd_Name
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.TopLoc import TopLoc_Location
import struct
from OCC.Core.TCollection import TCollection_AsciiString

D = os.path.dirname(os.path.abspath(__file__))
# (regex on sub-part name, rgb, metallic, roughness) — first match wins
YELLOW = (0.98, 0.76, 0.05)
RULES = [
    (r'screw|_9\d{4}a\d+', (0.10, 0.10, 0.11), 0.5, 0.45),
    (r'motor shield', YELLOW, 0.2, 0.45),                      # the yellow "jacket" over the motor can
    (r'shaft', (0.80, 0.81, 0.83), 0.85, 0.25),
    (r'pins?_|male ?pin', (0.85, 0.70, 0.25), 0.9, 0.3),
    (r'encoder cap|pin housing|cap\b|housing', (0.07, 0.07, 0.08), 0.2, 0.55),
    (r'\bbody\b', (0.75, 0.76, 0.78), 0.8, 0.3),
    (r'gear ?blank|gearbox', (0.16, 0.16, 0.18), 0.55, 0.42),   # planetary gearbox: dark anodised aluminium
    (r'bearing|snap ring', (0.16, 0.16, 0.18), 0.55, 0.42),
]
DEFAULT = ((0.77, 0.78, 0.81), 0.5, 0.4)

def colour_of(name):
    n = name.lower()
    for rx, c, m, r in RULES:
        if re.search(rx, n): return c, m, r
    return DEFAULT

def leaves(path):
    doc = TDocStd_Document('pythonocc-doc')
    rd = STEPCAFControl_Reader(); rd.SetNameMode(True)
    if rd.ReadFile(path) != 1: raise RuntimeError('read failed')
    rd.Transfer(doc)
    st = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
    out = []
    def name(lab):
        a = TDataStd_Name()
        try:
            return lab.GetLabelName() or ''
        except Exception:
            return ''
    def walk(lab, loc, pname):
        if st.IsReference(lab):
            ref = lab.__class__(); st.GetReferredShape(lab, ref)
            walk(ref, loc.Multiplied(st.GetLocation(lab)), name(ref) or pname); return
        if st.IsAssembly(lab):
            seq = TDF_LabelSequence(); st.GetComponents(lab, seq)
            for i in range(1, seq.Length() + 1): walk(seq.Value(i), loc, pname)
            return
        s = st.GetShape(lab)
        out.append((name(lab) or pname, s.Moved(loc)))
    roots = TDF_LabelSequence(); st.GetFreeShapes(roots)
    for i in range(1, roots.Length() + 1): walk(roots.Value(i), TopLoc_Location(), name(roots.Value(i)))
    return out

def write_glb_multi(path, groups):
    """groups: list of (P, I, rgb, metallic, rough). One mesh, one primitive per group."""
    bins, views, accs, prims, mats = b'', [], [], [], []
    pad = lambda b: b + b'\x00' * ((4 - len(b) % 4) % 4)
    allP = np.concatenate([g[0] for g in groups])
    for P, I, c, m, r in groups:
        N = np.zeros_like(P); tri = P[I]
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        for k in range(3): np.add.at(N, I[:, k], fn)
        N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
        a0 = len(accs)
        for data, target, comp, typ, cnt, mm in ((P.astype('<f4').tobytes(), 34962, 5126, 'VEC3', len(P), True),
                                                 (N.astype('<f4').tobytes(), 34962, 5126, 'VEC3', len(N), False),
                                                 (I.astype('<u4').tobytes(), 34963, 5125, 'SCALAR', int(I.size), False)):
            views.append({'buffer': 0, 'byteOffset': len(bins), 'byteLength': len(data), 'target': target})
            bins += pad(data)
            acc = {'bufferView': len(views) - 1, 'componentType': comp, 'count': cnt, 'type': typ}
            if mm: acc['min'] = P.min(0).tolist(); acc['max'] = P.max(0).tolist()
            accs.append(acc)
        mats.append({'pbrMetallicRoughness': {'baseColorFactor': [*c, 1], 'metallicFactor': m, 'roughnessFactor': r}})
        prims.append({'attributes': {'POSITION': a0, 'NORMAL': a0 + 1}, 'indices': a0 + 2, 'material': len(mats) - 1})
    # accessor 0 must carry the whole-part bounds (build_catalog reads accessors[0] min/max)
    accs[0]['min'] = allP.min(0).tolist(); accs[0]['max'] = allP.max(0).tolist()
    gltf = {'asset': {'version': '2.0', 'generator': 'Ignite3D STEP converter (OpenCascade, coloured)'},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}], 'meshes': [{'primitives': prims}],
            'materials': mats, 'buffers': [{'byteLength': len(bins)}], 'bufferViews': views, 'accessors': accs}
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bins))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bins), 0x004E4942) + bins
    open(path, 'wb').write(out)

def main(sku):
    meta = json.load(open(os.path.join(D, 'out', f'{sku}.json')))
    R, t = np.array(meta['R'], float), np.array(meta['t'], float)
    by = {}
    names = []
    for nm, s in leaves(os.path.join(D, 'step', f'{sku}.STEP')):
        c, m, r = colour_of(nm)
        P, I = tessellate(s)
        if not len(I): continue
        names.append((nm, c))
        if os.environ.get('V'): print('   ', repr(nm), c)
        P = (P.astype(float) @ R.T + t).astype(np.float32)
        g = by.setdefault((c, m, r), [[], [], 0])
        g[0].append(P); g[1].append(I + g[2]); g[2] += len(P)
    groups = [(np.concatenate(v[0]), np.concatenate(v[1]).astype(np.uint32), *k) for k, v in by.items()]
    glb = os.path.join(D, 'out', f'{sku}.glb')
    old = json.loads(open(glb, 'rb').read()[20:20 + struct.unpack('<I', open(glb, 'rb').read()[12:16])[0]])['accessors'][0]
    write_glb_multi(glb, groups)
    new = json.loads(open(glb, 'rb').read()[20:20 + struct.unpack('<I', open(glb, 'rb').read()[12:16])[0]])['accessors'][0]
    drift = max(abs(a - b) for a, b in zip(old['min'] + old['max'], new['min'] + new['max']))
    d = subprocess.run(['npx', 'gltf-transform', 'draco', glb, os.path.join(D, 'out', f'{sku}.draco.glb')], capture_output=True, text=True, cwd=D)
    print(sku, 'groups', len(groups), 'parts', len(names), 'bounds drift %.4f' % drift, 'draco', d.returncode)
    if drift > 0.05: print('  WARNING: frame drift', old, new)

if __name__ == '__main__':
    for s in sys.argv[1:]: main(s)
