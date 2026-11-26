"""Real colours for wheels (GripForce Gecko = black rubber; mecanum = rubber rollers on metal hubs).

python wheelcolor.py SKU [SKU ...]   -> rewrites out/{SKU}.glb + .draco.glb (same frame as convert.py)
Multi-body STEPs are coloured by sub-part name; single fused bodies are split face by face: faces whose
surface axis is tilted to the axle (or freeform faces far out) are rollers, the rest is hub.
"""
import json, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recolor import leaves, write_glb_multi
from extract import tessellate, load
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Torus, GeomAbs_SurfaceOfRevolution
from OCC.Core.TopoDS import topods
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop

D = os.path.dirname(os.path.abspath(__file__))
Y = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
RUBBER = ((0.075, 0.075, 0.08), 0.0, 0.85)
ROLLER_CORE = ((0.22, 0.22, 0.24), 0.05, 0.6)
HUB = ((0.80, 0.81, 0.83), 0.75, 0.32)     # clear-anodised aluminium plates
DARK = ((0.14, 0.14, 0.16), 0.55, 0.42)    # cores, bearings
STEEL = ((0.72, 0.73, 0.75), 0.85, 0.28)
SCREW = ((0.10, 0.10, 0.11), 0.5, 0.45)
NAME_RULES = [
    (r'screw|locknut|_9\d{4}a|2800-|2812-|2815-|m4 x', SCREW),
    (r'tire|cover|roller ?tire', RUBBER),
    (r'roller ?core', ROLLER_CORE),
    (r'pin|axle|e-clip|shim', STEEL),
    (r'\bor\b|\bir\b|1600-|bearing', DARK),
    (r'side plate|paint', HUB),
    (r'core|solid|2824', DARK),
]

def name_colour(n):
    n = n.lower()
    for rx, c in NAME_RULES:
        if re.search(rx, n): return c
    return HUB

def face_groups(shape, M, t, radius):
    BRepMesh_IncrementalMesh(shape, 0.04, False, 0.35, True)
    out = {}
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = topods.Face(ex.Current()); s = BRepAdaptor_Surface(f); ty = s.GetType()
        ax = None
        if ty == GeomAbs_Plane: ax = s.Plane().Axis()
        elif ty == GeomAbs_Cylinder: ax = s.Cylinder().Axis()
        elif ty == GeomAbs_Cone: ax = s.Cone().Axis()
        elif ty == GeomAbs_Torus: ax = s.Torus().Axis()
        elif ty == GeomAbs_SurfaceOfRevolution: ax = s.AxeOfRevolution()
        g = GProp_GProps(); brepgprop.SurfaceProperties(f, g); c = g.CentreOfMass()
        pc = M @ np.array([c.X(), c.Y(), c.Z()]) + t
        rc = float(np.hypot(pc[1], pc[2]))
        if ax is not None:
            d = M @ np.array([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()])
            tilt = 0.15 < abs(d[0]) < 0.95
            roller = tilt and rc > 0.45 * radius
        else:
            roller = rc > 0.6 * radius
        col = RUBBER if roller else HUB
        P, I = tessellate(f)
        if len(I): out.setdefault(col, []).append((P, I))
        ex.Next()
    return out

def main(sku, mode):
    meta = json.load(open(os.path.join(D, 'out', f'{sku}.json')))
    R, t = np.array(meta['R'], float), np.array(meta['t'], float)
    step = os.path.join(D, 'step', f'{sku}.STEP')
    radius = max(abs(meta['bbox'][0][1]), meta['bbox'][1][1])
    by = {}
    def add(col, P, I):
        P = (P.astype(float) @ R.T + t).astype(np.float32)
        g = by.setdefault(col, [[], [], 0]); g[0].append(P); g[1].append(I + g[2]); g[2] += len(P)
    if mode == 'rubber':
        P, I = tessellate(load(step)); add(RUBBER, P, I)
    elif mode == 'names':
        for nm, s in leaves(step):
            P, I = tessellate(s)
            if len(I): add(name_colour(nm), P, I)
    else:  # faces (with screws by name when the STEP has separate bodies)
        for nm, s in leaves(step):
            if re.search(NAME_RULES[0][0], nm.lower()):
                P, I = tessellate(s)
                if len(I): add(SCREW, P, I)
                continue
            for col, lst in face_groups(s, R @ Y, t, radius).items():
                for P, I in lst: add(col, P, I)
    groups = [(np.concatenate(v[0]), np.concatenate(v[1]).astype(np.uint32), *k) for k, v in by.items()]
    glb = os.path.join(D, 'out', f'{sku}.glb')
    write_glb_multi(glb, groups)
    d = subprocess.run(['npx', 'gltf-transform', 'draco', glb, os.path.join(D, 'out', f'{sku}.draco.glb')], capture_output=True, text=True, cwd=D)
    print(sku, mode, 'groups', [(k[0], len(v[1])) for k, v in by.items()], 'draco', d.returncode)

MODES = {'3625-0202-0104': 'names', '3213-3606-0003': 'names', '3213-3606-0002': 'faces', '3629-0001-0048': 'faces', '3629-0100-0048': 'faces'}
if __name__ == '__main__':
    for s in sys.argv[1:]: main(s, MODES.get(s, 'rubber'))
