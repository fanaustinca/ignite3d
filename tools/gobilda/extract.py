"""goBILDA STEP -> exact hole data (+ tessellated mesh) using OpenCascade.

Usage: python extract.py file.STEP out.json [mesh.npz]
Coordinates are converted from the STEP's Z-up to Ignite3D's Y-up: (x, y, z) -> (x, z, -y).

Holes: every concave cylindrical face is grouped by (axis line, radius); overlapping axial
extents are merged into one hole segment. Each segment end is classified as OPEN (air beyond it:
a snap face) or BLIND (material beyond it). Hex/REX bores are found as rings of 6 planar faces.
"""
import json, math, sys
from collections import defaultdict
import numpy as np
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_IN, TopAbs_REVERSED
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCC.Core.BRepTools import breptools
from OCC.Core.BRepClass3d import BRepClass3d_SolidClassifier
from OCC.Core.gp import gp_Pnt
from OCC.Core.TopoDS import topods
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.BRep import BRep_Tool
from OCC.Core.TopLoc import TopLoc_Location
from OCC.Core.Bnd import Bnd_Box
from OCC.Core.BRepBndLib import brepbndlib

def to_yup(p):  # STEP Z-up -> Y-up
    return np.array([p[0], p[2], -p[1]], dtype=float)

def load(path):
    r = STEPControl_Reader()
    if r.ReadFile(path) != 1:
        raise RuntimeError('read failed')
    r.TransferRoots()
    return r.OneShape()

def solids(shape):
    out = []
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    while ex.More():
        out.append(ex.Current()); ex.Next()
    return out

def inside_any(classifiers, p):
    for item in classifiers:
        c, (x0, y0, z0, x1, y1, z1) = item
        if not (x0 - 0.01 <= p[0] <= x1 + 0.01 and y0 - 0.01 <= p[1] <= y1 + 0.01 and z0 - 0.01 <= p[2] <= z1 + 0.01):
            continue  # point outside this solid's bounding box: cannot be inside it
        c.Perform(gp_Pnt(*p), 1e-4)
        if c.State() == TopAbs_IN:
            return True
    return False

def extract(path):
    shape = load(path)
    sol = solids(shape)
    def _bb(s):
        b = Bnd_Box(); brepbndlib.Add(s, b); return b.Get()
    classifiers = [(BRepClass3d_SolidClassifier(s), _bb(s)) for s in sol]
    props = GProp_GProps(); brepgprop.VolumeProperties(shape, props)
    volume = props.Mass()
    bb = Bnd_Box(); brepbndlib.Add(shape, bb)
    x0, y0, z0, x1, y1, z1 = bb.Get()

    cyl = defaultdict(list)  # key -> list of (tmin, tmax)
    planes = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = topods.Face(ex.Current())
        a = BRepAdaptor_Surface(f)
        t = a.GetType()
        if t == GeomAbs_Cylinder:
            cy = a.Cylinder()
            ax = cy.Axis()
            d = np.array([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()])
            o = np.array([ax.Location().X(), ax.Location().Y(), ax.Location().Z()])
            # canonical direction
            k = np.argmax(np.abs(d))
            if d[k] < 0: d = -d
            r = cy.Radius()
            umin, umax, vmin, vmax = breptools.UVBounds(f)
            # concave (hole) test: a point on the face, offset toward the axis, must be outside material
            um, vm = (umin + umax) / 2, (vmin + vmax) / 2
            p = a.Value(um, vm); P = np.array([p.X(), p.Y(), p.Z()])
            foot = o + d * np.dot(P - o, d)
            radial = (P - foot) / (np.linalg.norm(P - foot) or 1)
            hole = not inside_any(classifiers, P - radial * min(0.2, r * 0.3)) and inside_any(classifiers, P + radial * 0.15)
            # axial extent: project face corners
            ts = []
            for u in (umin, um, umax):
                for v in (vmin, vmax):
                    q = a.Value(u, v); ts.append(np.dot(np.array([q.X(), q.Y(), q.Z()]) - o, d))
            # axis line id: foot point of origin projected on plane perpendicular to d
            base = o - d * np.dot(o, d)
            key = (tuple(np.round(d, 4)), tuple(np.round(base, 2)), round(r, 3), hole)
            cyl[key].append((min(ts) + np.dot(o, d), max(ts) + np.dot(o, d), umax - umin))
        elif t == GeomAbs_Plane:
            pl = a.Plane(); n = pl.Axis().Direction(); l = pl.Location()
            nn = np.array([n.X(), n.Y(), n.Z()])
            if f.Orientation() == TopAbs_REVERSED: nn = -nn
            umin, umax, vmin, vmax = breptools.UVBounds(f)
            c = a.Value((umin + umax) / 2, (vmin + vmax) / 2)
            planes.append((nn, np.array([c.X(), c.Y(), c.Z()])))
        ex.Next()

    holes = []
    bosses = []
    for (d, base, r, hole), spans in cyl.items():
        d = np.array(d); base = np.array(base)
        spans.sort()
        merged = []
        for s0, s1, ang in spans:
            if merged and s0 <= merged[-1][1] + 1e-3:
                merged[-1][1] = max(merged[-1][1], s1); merged[-1][2] += ang
            else:
                merged.append([s0, s1, ang])
        for s0, s1, ang in merged:
            if s1 - s0 < 1e-3: continue
            full = ang > 2 * math.pi * 0.97  # complete circle (vs. fillet / slot arc)
            c0 = base + d * s0; c1 = base + d * s1
            rec = {'dir': to_yup(d).round(6).tolist(), 'r': round(r, 4), 'c0': to_yup(c0).round(4).tolist(),
                   'c1': to_yup(c1).round(4).tolist(), 'len': round(s1 - s0, 4), 'full': bool(full), 'arc': round(min(ang, 2 * math.pi), 3)}
            if hole:
                eps = 0.3
                rec['open0'] = not inside_any(classifiers, c0 - d * eps)
                rec['open1'] = not inside_any(classifiers, c1 + d * eps)
                holes.append(rec)
            else:
                bosses.append(rec)
    bbox = [to_yup((x0, y0, z0)), to_yup((x1, y1, z1))]
    lo = np.minimum(bbox[0], bbox[1]); hi = np.maximum(bbox[0], bbox[1])
    return {'volume': volume, 'bbox': [lo.round(4).tolist(), hi.round(4).tolist()], 'solids': len(sol), 'holes': holes,
            'bosses': bosses, 'planes': len(planes)}, shape

def write_glb(path, P, I, color=(0.77, 0.78, 0.81), metallic=0.5, rough=0.4):
    """Minimal binary glTF 2.0 writer (positions + smooth-per-face normals + uint32 indices), millimetres, Y-up."""
    import struct
    N = np.zeros_like(P)
    tri = P[I]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3): np.add.at(N, I[:, k], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    pb, nb, ib = P.astype('<f4').tobytes(), N.astype('<f4').tobytes(), I.astype('<u4').tobytes()
    pad = lambda b: b + b'\x00' * ((4 - len(b) % 4) % 4)
    bin_ = pad(pb) + pad(nb) + pad(ib)
    o1 = len(pad(pb)); o2 = o1 + len(pad(nb))
    gltf = {
        'asset': {'version': '2.0', 'generator': 'Ignite3D STEP converter (OpenCascade)'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1}, 'indices': 2, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'baseColorFactor': [*color, 1], 'metallicFactor': metallic, 'roughnessFactor': rough}}],
        'buffers': [{'byteLength': len(bin_)}],
        'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(pb), 'target': 34962},
                        {'buffer': 0, 'byteOffset': o1, 'byteLength': len(nb), 'target': 34962},
                        {'buffer': 0, 'byteOffset': o2, 'byteLength': len(ib), 'target': 34963}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
            {'bufferView': 1, 'componentType': 5126, 'count': len(N), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5125, 'count': int(I.size), 'type': 'SCALAR'}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bin_
    open(path, 'wb').write(out)

def tessellate(shape, defl=0.04, ang=0.35):
    BRepMesh_IncrementalMesh(shape, defl, False, ang, True)
    pos, nrm, idx = [], [], []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = topods.Face(ex.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation(f, loc)
        if tri is not None:
            tr = loc.Transformation()
            base = len(pos)
            rev = f.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(tr)
                pos.append(to_yup((p.X(), p.Y(), p.Z())))
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                if rev: b, c = c, b
                idx.append((base + a - 1, base + b - 1, base + c - 1))
        ex.Next()
    return np.array(pos, dtype=np.float32), np.array(idx, dtype=np.uint32)

if __name__ == '__main__':
    data, shape = extract(sys.argv[1])
    json.dump(data, open(sys.argv[2], 'w'))
    if len(sys.argv) > 3:
        P, I = tessellate(shape)
        np.savez_compressed(sys.argv[3], pos=P, idx=I)
        data['tris'] = int(len(I))
    print(json.dumps({k: data[k] for k in ('volume', 'bbox', 'solids', 'planes')}), 'holes', len(data['holes']), 'bosses', len(data['bosses']), 'tris', data.get('tris'))
