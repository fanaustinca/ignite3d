"""Validate an Ignite3D STEP export with OpenCascade (run in the `occt` conda env).
Checks: assembly structure, instance count/placement, every solid valid & closed, volumes."""
import json, sys
from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
from OCC.Core.TDF import TDF_LabelSequence
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.BRepCheck import BRepCheck_Analyzer
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Cylinder
from OCC.Core.TopoDS import topods

step, expf = sys.argv[1], sys.argv[2]
exp = json.load(open(expf))
doc = TDocStd_Document("ign")
r = STEPCAFControl_Reader(); r.SetNameMode(True)
assert r.ReadFile(step) == IFSelect_RetDone, "read failed"
assert r.Transfer(doc), "transfer failed"
st = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
free = TDF_LabelSequence(); st.GetFreeShapes(free)
assert free.Length() == 1, f"expected 1 root, got {free.Length()}"
rootL = free.Value(1)
assert st.IsAssembly(rootL), "root is not an assembly"
comps = TDF_LabelSequence(); st.GetComponents(rootL, comps)
n_exp = len(exp["instances"])
assert comps.Length() == n_exp, f"components {comps.Length()} != {n_exp}"
fail = 0; cyl_faces = 0
for i in range(1, comps.Length() + 1):
    c = comps.Value(i)
    e = exp["instances"][i - 1]
    loc = st.GetLocation(c).Transformation().TranslationPart()
    d = ((loc.X()-e["pos"][0])**2 + (loc.Y()-e["pos"][1])**2 + (loc.Z()-e["pos"][2])**2) ** 0.5
    ref = TDF_LabelSequence(); 
    from OCC.Core.TDF import TDF_Label
    refL = TDF_Label(); st.GetReferredShape(c, refL)
    shape = st.GetShape(refL)
    solids = 0; vol = 0.0; bad = 0
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    while ex.More():
        s = ex.Current(); solids += 1
        if not BRepCheck_Analyzer(s).IsValid(): bad += 1
        g = GProp_GProps(); brepgprop.VolumeProperties(s, g); vol += g.Mass()
        ex.Next()
    fx = TopExp_Explorer(shape, TopAbs_FACE)
    while fx.More():
        if BRepAdaptor_Surface(topods.Face(fx.Current())).GetType() == GeomAbs_Cylinder: cyl_faces += 1
        fx.Next()
    rel = abs(vol - e["volume"]) / e["volume"]
    ok = d < 1e-3 and solids == e["solids"] and bad == 0 and rel < 0.005
    if not ok: fail += 1
    print(f"{'OK ' if ok else 'BAD'} {e['sku']:16} solids={solids}/{e['solids']} invalid={bad} vol={vol:10.1f} exp={e['volume']:10.1f} ({rel*100:.3f}%) posErr={d:.2e}")
print(f"cylindrical faces: {cyl_faces}")
print("RESULT:", "PASS" if fail == 0 else f"FAIL ({fail})")
sys.exit(1 if fail else 0)
