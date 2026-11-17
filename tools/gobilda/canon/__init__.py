"""Per-family canonicalisation rules.

A rule module canon/rules_<name>.py defines:
    PREFIXES = ['2800-', '2802-']                  # SKUs it handles
    def rule(ctx) -> dict | None

ctx (all coordinates Y-up mm, BEFORE canonicalisation):
    sku, title, bbox [lo, hi], centroid, volume_mm3,
    holes  : raw hole segments  {dir, r, c0, c1, len, full, arc, open0, open1}
    bosses : convex cylinders   {dir, r, c0, c1, len, full, arc}
    snaps  : hole snap faces    {id, type, p, n, depth, tapped, holeId, full}
Return {'R': 3x3 (list), 't': [3], 'male': [snap in FINAL frame], 'notes': str} where FINAL = R @ x + t.
Male snap = {'id','type','position','normal','upVector'?}; normal points in the insertion direction.
Return None to fall back to registration / bbox centring.
"""
import importlib, os, pkgutil

def find_rule(sku):
    for m in pkgutil.iter_modules([os.path.dirname(__file__)]):
        if not m.name.startswith('rules_'):
            continue
        mod = importlib.import_module(f'canon.{m.name}')
        if any(sku.startswith(p) for p in getattr(mod, 'PREFIXES', [])):
            return mod
    return None
