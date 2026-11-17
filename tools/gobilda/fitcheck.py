"""Fit check between two real goBILDA parts, using Ignite3D's exact mating rule.

python fitcheck.py A_SKU A_SNAP_ID B_SKU B_SNAP_ID [quarter_turns=auto]
  B's snap B_SNAP_ID is mated onto A's snap A_SNAP_ID (positions coincide, normals oppose, up vectors
  aligned + quarter_turns*90 deg about the axis; 'auto' = the turn that aligns the most holes, like the app).
Reports: coincident hole faces, interference volume (OpenCascade boolean common of the two solids) and the
B placement. Snap ids/positions come from out/{SKU}.json (plus overrides/{SKU}.json if present).
"""
import json, os, sys
import numpy as np
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.gp import gp_Trsf
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Common
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop

D = os.path.dirname(os.path.abspath(__file__))
Y = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)

def snaps(sku):
    meta = json.load(open(os.path.join(D, 'out', f'{sku}.json')))
    ov_path = os.path.join(D, 'overrides', f'{sku}.json')
    ov = json.load(open(ov_path)) if os.path.exists(ov_path) else {}
    rm = set(ov.get('removeSnapIds', []))
    out = [s for s in meta['snaps'] if s['id'] not in rm] + ov.get('addSnaps', [])
    for m in ov.get('male', []):
        out.append({'id': m['id'], 'type': m['type'], 'p': m.get('position', m.get('p')), 'n': m.get('normal', m.get('n')),
                    'up': m.get('upVector'), 'male': True})
    return meta, out

def perp(n):
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    a = a - n * a.dot(n)
    return a / np.linalg.norm(a)

def up_of(s):
    n = np.array(s['n'], float); n /= np.linalg.norm(n)
    u = s.get('up')
    if u is not None:
        u = np.array(u, float); u = u - n * u.dot(n)
        if np.linalg.norm(u) > 1e-6: return u / np.linalg.norm(u)
    return perp(n)

def mate(ghost, target_p, target_n, target_u, angle):
    """Same as Ignite3D mateTransform(): returns rotation Q and translation T (world = Q @ local + T)."""
    nA = np.array(ghost['n'], float); nA /= np.linalg.norm(nA); uA = up_of(ghost); wA = np.cross(nA, uA)
    nT = -np.array(target_n, float); nT /= np.linalg.norm(nT)
    uB = np.array(target_u, float); tn = np.array(target_n, float) / np.linalg.norm(target_n)
    uB = uB - tn * uB.dot(tn)
    if np.linalg.norm(uB) < 1e-8: uB = perp(tn)
    uB /= np.linalg.norm(uB)
    # rotate uB about target normal by angle (Rodrigues)
    k = tn; uB = uB * np.cos(angle) + np.cross(k, uB) * np.sin(angle) + k * k.dot(uB) * (1 - np.cos(angle))
    wT = np.cross(nT, uB)
    BA = np.column_stack([nA, uA, wA]); BT = np.column_stack([nT, uB, wT])
    Q = BT @ BA.T
    T = np.array(target_p, float) - Q @ np.array(ghost['p'], float)
    return Q, T

def shape(sku, Q=np.eye(3), T=np.zeros(3)):
    meta = json.load(open(os.path.join(D, 'out', f'{sku}.json')))
    R = np.array(meta['R']); t = np.array(meta['t'])
    M = Q @ R @ Y; tt = Q @ t + T
    r = STEPControl_Reader(); r.ReadFile(os.path.join(D, 'step', f'{sku}.STEP')); r.TransferRoots()
    tr = gp_Trsf(); tr.SetValues(*M[0], tt[0], *M[1], tt[1], *M[2], tt[2])
    return BRepBuilderAPI_Transform(r.OneShape(), tr, True).Shape()

def coincident(sa, sb, Q, T):
    PA = np.array([s['p'] for s in sa]); NA = np.array([s['n'] for s in sa])
    n = 0
    for s in sb:
        p = Q @ np.array(s['p']) + T; q = Q @ np.array(s['n'])
        d = np.linalg.norm(PA - p, axis=1)
        if np.any((d < 0.05) & (NA @ q < -0.999)): n += 1
    return n

def main():
    a_sku, a_id, b_sku, b_id = sys.argv[1:5]
    turns = sys.argv[5] if len(sys.argv) > 5 else 'auto'
    _, sa = snaps(a_sku); _, sb = snaps(b_sku)
    A = next(s for s in sa if s['id'] == a_id); B = next(s for s in sb if s['id'] == b_id)
    cands = range(4) if turns == 'auto' else [int(turns)]
    best = max(((coincident(sa, sb, *mate(B, A['p'], A['n'], up_of(A), k * np.pi / 2)), k) for k in cands))
    k = best[1]
    Q, T = mate(B, A['p'], A['n'], up_of(A), k * np.pi / 2)
    common = BRepAlgoAPI_Common(shape(a_sku), shape(b_sku, Q, T)).Shape()
    g = GProp_GProps(); brepgprop.VolumeProperties(common, g)
    res = {'A': a_sku, 'A_snap': a_id, 'B': b_sku, 'B_snap': b_id, 'quarter_turns': k, 'coincident_hole_faces': best[0],
           'interference_mm3': round(abs(g.Mass()), 3), 'B_rotation': np.round(Q, 6).tolist(), 'B_translation': np.round(T, 4).tolist()}
    print(json.dumps(res))

if __name__ == '__main__':
    main()
