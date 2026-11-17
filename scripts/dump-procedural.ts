// Dumps procedural part data (bbox, centroid, female/male snaps) for registering real goBILDA STEP data.
import { writeFileSync } from 'node:fs';
import { BUILTIN_CATALOG } from '../src/data/catalog';
import { triangulateRecipe, recipeBounds } from '../src/geometry/recipe';

const out: Record<string, unknown> = {};
for (const p of BUILTIN_CATALOG) {
  const r = p.procedural!;
  const solids = { solids: r.solids.filter((s) => !s.decal) };
  // volume centroid via divergence theorem
  let V = 0, cx = 0, cy = 0, cz = 0;
  for (const arr of triangulateRecipe(solids).values())
    for (let i = 0; i < arr.length; i += 9) {
      const [ax, ay, az, bx, by, bz, qx, qy, qz] = arr.slice(i, i + 9);
      const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
      V += v; cx += v * (ax + bx + qx) / 4; cy += v * (ay + by + qy) / 4; cz += v * (az + bz + qz) / 4;
    }
  const b = recipeBounds(solids);
  out[p.sku] = {
    name: p.name, series: p.series, category: p.category,
    bbox: [b.min, b.max], centroid: [cx / V, cy / V, cz / V], volume: V,
    female: p.snapPoints.filter((s) => !s.male).map((s) => ({ id: s.id, p: s.position, n: s.normal, type: s.type, tapped: !!s.tapped })),
    male: p.snapPoints.filter((s) => s.male),
  };
}
writeFileSync(process.argv[2] ?? 'procedural.json', JSON.stringify(out));
console.log('dumped', Object.keys(out).length);
