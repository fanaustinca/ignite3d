"""Validate an exported STEP assembly with OpenCascade: one root assembly, N components,
every solid valid. Usage: python validate_step_basic.py file.step N"""
import sys
from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
from OCC.Core.TDF import TDF_LabelSequence, TDF_Label
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.BRepCheck import BRepCheck_Analyzer
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_SOLID

path, n = sys.argv[1], int(sys.argv[2])
doc = TDocStd_Document("ign")
r = STEPCAFControl_Reader(); r.SetNameMode(True)
assert r.ReadFile(path) == IFSelect_RetDone, "read failed"
assert r.Transfer(doc), "transfer failed"
st = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
free = TDF_LabelSequence(); st.GetFreeShapes(free)
assert free.Length() == 1 and st.IsAssembly(free.Value(1)), "no single root assembly"
comps = TDF_LabelSequence(); st.GetComponents(free.Value(1), comps)
assert comps.Length() == n, f"{comps.Length()} components != {n}"
seen, solids, bad = set(), 0, 0
for i in range(1, comps.Length() + 1):
    ref = TDF_Label(); st.GetReferredShape(comps.Value(i), ref)
    if ref.Tag() in seen: continue
    seen.add(ref.Tag())
    ex = TopExp_Explorer(st.GetShape(ref), TopAbs_SOLID)
    while ex.More():
        solids += 1
        if not BRepCheck_Analyzer(ex.Current()).IsValid(): bad += 1
        ex.Next()
assert bad == 0, f"{bad} invalid solids"
print(f"OCCT: {comps.Length()} instances, {len(seen)} unique parts, {solids} valid solids")
