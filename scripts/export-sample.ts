// Writes a sample STEP assembly + expected values, for OpenCascade validation (tests/validate_step.py).
import { writeFileSync, mkdirSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { BUILTIN_CATALOG } from '../src/data/catalog';
import { exportStep } from '../src/export/step';
import { recipeVolume } from '../src/geometry/recipe';
import type { PlacedInstance } from '../src/types/cad';

const cat = Object.fromEntries(BUILTIN_CATALOG.map((p) => [p.sku, p]));
const all = process.argv.includes('--all');
const skus = all ? BUILTIN_CATALOG.map((p) => p.sku) : ['1120-0005-0144', '5203-2402-0019', '2800-0004-0010', '2810-0004-0001', '3625-0001-0096', '1209-0024-0045', '2302-0008-0064', '1506-0814-0004'];
const insts: PlacedInstance[] = [];
skus.forEach((sku, i) => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), i * 0.7);
  insts.push({ instanceId: `i${i}`, sku, position: [i * 200, 10 * i, -5 * i], quaternion: [q.x, q.y, q.z, q.w], hidden: false, ghosted: false });
});
// a second instance of the first SKU to verify shared part definitions
insts.push({ instanceId: 'dup', sku: skus[0], position: [0, 100, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false });
const out = process.argv[2] ?? 'tests/fixtures';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/sample.step`, exportStep(insts, cat, { name: 'Sample' }));
const expected = {
  instances: insts.map((i) => {
    const p = new Vector3(...i.position).applyAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    return { sku: i.sku, pos: p.toArray(), volume: recipeVolume({ solids: cat[i.sku].procedural!.solids.filter((s) => !s.decal) }), solids: cat[i.sku].procedural!.solids.filter((s) => !s.decal).length };
  }),
};
writeFileSync(`${out}/sample.expected.json`, JSON.stringify(expected, null, 1));
console.log('wrote', insts.length, 'instances');
