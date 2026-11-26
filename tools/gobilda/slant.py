"""Mecanum slant: sign of the top roller's axis (dx*dz) in the PART frame (axle along X)."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import load
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Cylinder
from OCC.Core.TopoDS import topods
Y = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)

def slant(sku):
    meta = json.load(open(f'out/{sku}.json')); M = np.array(meta['R']) @ Y; t = np.array(meta['t'])
    ex = TopExp_Explorer(load(f'step/{sku}.STEP'), TopAbs_FACE); best = None
    while ex.More():
        s = BRepAdaptor_Surface(topods.Face(ex.Current()))
        if s.GetType() == GeomAbs_Cylinder:
            ax = s.Cylinder().Axis(); d = M @ np.array([ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()])
            p = M @ np.array([ax.Location().X(), ax.Location().Y(), ax.Location().Z()]) + t
            r = s.Cylinder().Radius()
            if abs(d[0]) < 0.9 and abs(d[0]) > 0.3 and abs(d[1]) < 0.2 and p[1] > 0:
                if best is None or p[1] > best[0]: best = (p[1], d, r)
        ex.Next()
    return None if best is None else float(np.sign(best[1][0] * best[1][2])), best

for s in sys.argv[1:]: print(s, slant(s))
