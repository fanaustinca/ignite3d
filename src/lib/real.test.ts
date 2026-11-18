// Snapping / fastening / example build against the REAL goBILDA data (public/parts/*.json from goBILDA STEP files).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, SnapPoint } from '../types/cad';
import { BUILTIN_CATALOG, USING_REAL_CATALOG } from '../data/catalog';
import { mateTransform, toQuat, toVec3, worldSnaps, distToLine } from './snap';
import { planFasten } from './fasten';
import { fastenOptions, planFastenAt, planJointFasteners } from '../store/useCadStore';
import { bestAlignment, occupiedFaces } from './placement';
import { buildExampleRobot } from './example';
import { robotBounds, sizeCheck } from './metrics';

const PARTS = 'public/parts';
const real = USING_REAL_CATALOG && existsSync(`${PARTS}/1120-0005-0144.json`);
const cat: Record<string, CatalogPart> = {};
if (real)
  for (const p of BUILTIN_CATALOG) {
    const f = `${PARTS}/${p.sku}.json`;
    cat[p.sku] = existsSync(f) ? { ...p, snapPoints: (JSON.parse(readFileSync(f, 'utf8')) as { snapPoints: SnapPoint[] }).snapPoints } : p;
  }
const inst = (id: string, sku: string, pos = new Vector3(), q = new Quaternion()): PlacedInstance => ({
  instanceId: id, sku, position: toVec3(pos), quaternion: toQuat(q), hidden: false, ghosted: false,
});
const all = (list: PlacedInstance[]) => list.flatMap((i) => worldSnaps(i, cat[i.sku]));

describe.skipIf(!real)('real goBILDA parts', () => {
  it('catalogue has the real parts with measured snap points', () => {
    expect(BUILTIN_CATALOG.length).toBeGreaterThan(500);
    for (const sku of ['1120-0005-0144', '5203-2402-0019', '2800-0004-0010', '2812-0004-0007', '1309-0016-4008', '1611-0514-4008'])
      expect(cat[sku]?.snapPoints.length, sku).toBeGreaterThan(0);
    // conventions the app relies on
    const screw = cat['2800-0004-0010'];
    const uh = screw.snapPoints.find((s) => s.male)!;
    expect(uh.position.map((x) => Math.abs(x))).toEqual([0, 0, 0]);
    expect(uh.normal[1]).toBeCloseTo(-1, 6);
    expect(screw.dimensions![1]).toBeCloseTo(14, 1); // 10 mm shank + 4 mm head
    expect(cat['2812-0004-0007'].dimensions![1]).toBeCloseTo(4.85, 2);
    const shaft = cat['5203-2402-0019'].snapPoints.find((s) => s.male)!;
    expect(shaft.type).toBe('rex_8mm');
    expect(Math.hypot(...shaft.position)).toBeLessThan(1e-6);
  });

  it('two real 1120 channels stacked web-to-web: many holes coincide; Smart Fasten -> M4x10 + nyloc', () => {
    const A = inst('A', '1120-0005-0144');
    const sp = cat[A.sku].snapPoints;
    const bore = sp.find((s) => s.type === 'bearing_14mm' && s.normal[1] < -0.99 && Math.abs(s.position[0]) < 1e-3)!;
    const target = worldSnaps(A, cat[A.sku]).find((s) => s.snap.id === bore.id)!;
    const m = mateTransform(bore, target, Math.PI);
    const B = inst('B', A.sku, m.position, m.quaternion);
    const snaps = all([A, B]);
    const a = snaps.filter((s) => s.instanceId === 'A');
    const coincident = snaps.filter((s) => s.instanceId === 'B' && a.some((q) => q.pos.distanceTo(s.pos) < 1e-3 && q.normal.dot(s.normal) < -0.999));
    expect(coincident.length).toBeGreaterThanOrEqual(30);
    const click = coincident.find((s) => s.snap.type === 'm4_hole')!;
    const plan = planFasten(click, snaps, fastenOptions(cat));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.grip).toBeCloseTo(5, 3); // two 2.5 mm webs
    expect(plan.threadedEnd).toBe(false);
    expect(plan.screwLength).toBe(10); // 5 mm grip + 4.85 mm nyloc
  });

  it('real Yellow Jacket face on a real 1120: 4 tapped holes align, shaft through the 14 mm bore, screw threads in', () => {
    const C = inst('C', '1120-0003-0096');
    const cs = worldSnaps(C, cat[C.sku]);
    const bore = cs.find((s) => s.snap.type === 'bearing_14mm' && s.normal.y < -0.99 && Math.abs(s.pos.x) < 1e-3)!;
    const motor = cat['5203-2402-0019'];
    let best: { n: number; M: PlacedInstance } | null = null;
    for (const g of motor.snapPoints.filter((s) => s.tapped && !s.male && Math.abs(s.position[1]) < 0.01 && s.normal[1] > 0.99))
      for (const t of cs.filter((s) => s.snap.type === 'm4_hole' && s.normal.y < -0.99 && s.pos.distanceTo(bore.pos) < 13))
        for (let k = 0; k < 4; k++) {
          const m = mateTransform(g, t, (k * Math.PI) / 2);
          const M = inst('M', motor.sku, m.position, m.quaternion);
          const sh = worldSnaps(M, motor).find((s) => s.snap.male)!;
          if (distToLine(bore.pos, sh.pos, sh.normal) > 1e-3) continue;
          const n = worldSnaps(M, motor).filter((s) => s.snap.type === 'm4_hole' && cs.some((q) => q.pos.distanceTo(s.pos) < 1e-3 && q.normal.dot(s.normal) < -0.999)).length;
          if (!best || n > best.n) best = { n, M };
        }
    expect(best).not.toBeNull();
    expect(best!.n).toBe(4);
    const snaps = all([C, best!.M]);
    const inner = snaps.find((s) => s.instanceId === 'C' && s.snap.type === 'm4_hole' && s.normal.y > 0.99 && snaps.some((q) => q.instanceId === 'M' && q.snap.tapped && Math.hypot(q.pos.x - s.pos.x, q.pos.z - s.pos.z) < 1e-3))!;
    const plan = planFasten(inner, snaps, fastenOptions(cat));
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.threadedEnd).toBe(true);
      expect(plan.nut).toBeUndefined();
      expect(plan.screwLength).toBeGreaterThanOrEqual(6);
      expect(plan.screwLength).toBeLessThanOrEqual(12);
    }
  });

  it('example drivetrain builds from real parts, fully fastened, inside the 18" cube', () => {
    const robot = buildExampleRobot(cat);
    const count = (p: string) => robot.filter((i) => i.sku.startsWith(p)).length;
    expect(count('1120-')).toBe(4);
    expect(count('5203-')).toBe(4);
    expect(count('1309-')).toBe(4);
    expect(robot.filter((i) => /^36(01|14)-/.test(i.sku)).length).toBe(4);
    expect(count('2800-')).toBeGreaterThanOrEqual(32);
    expect(sizeCheck(robotBounds(robot, cat)).over).toBe(false);
  });

  it('U-channel T joint through a quad block mount: channel slides over the blocks, screws sit flush on the outside', () => {
    const A = inst('A', '1120-0005-0144');
    const as = worldSnaps(A, cat[A.sku]);
    const qb = cat['1201-0043-0002'];
    // quad block plate on the outside of A's web, centred on the web's 8 mm pattern
    const tA = as.find((s) => s.snap.type === 'm4_hole' && s.normal.y < -0.99 && Math.abs(s.pos.x - 8) < 1e-3 && Math.abs(s.pos.z - 8) < 1e-3)!;
    const aQ = qb.snapPoints.find((s) => !s.tapped && s.normal[1] < -0.99 && Math.abs(s.position[0] - 8) < 0.1 && Math.abs(s.position[2] - 8) < 0.1)!;
    const mQ = mateTransform(aQ, tA, (bestAlignment(aQ, tA, qb, as) * Math.PI) / 2);
    const Q = inst('Q', qb.sku, mQ.position, mQ.quaternion);
    const qs = worldSnaps(Q, qb);
    // channel B's end slides over the four blocks: a flange-inner hole onto a block's outer tapped face
    const block = qs.find((s) => s.snap.id === 'h0a')!;
    const bp = cat['1120-0005-0144'];
    const aB = bp.snapPoints.find((s) => s.id === 'h65b')!; // flange inner face, 8 mm from the end
    const mB = mateTransform(aB, block, (bestAlignment(aB, block, bp, qs) * Math.PI) / 2);
    const B = inst('B', bp.sku, mB.position, mB.quaternion);
    const bs = worldSnaps(B, bp);
    const opposed = bs.filter((s) => qs.some((q) => q.pos.distanceTo(s.pos) < 1e-3 && q.normal.dot(s.normal) < -0.999)).length;
    const sameWay = bs.filter((s) => qs.some((q) => q.pos.distanceTo(s.pos) < 1e-3 && q.normal.dot(s.normal) > 0.999)).length;
    expect(opposed).toBeGreaterThanOrEqual(4); // both flanges (and the web) land on block faces
    expect(sameWay).toBe(0); // no material inside material

    // buried faces (block face under B's flange) are occupied, so nothing else can snap into the wall
    const list = [A, Q, B];
    const occ = occupiedFaces(list, cat, (i, p) => worldSnaps(i, p));
    const buried = [...occ].find((s) => s.instanceId === 'Q' && s.snap.id === 'h0a');
    expect(buried).toBeDefined();

    // hand-placing a screw "into" that buried block face is resolved by Smart Fasten: head on B's outer face
    const plan = planFastenAt(list, cat, 'Q', 'h0a');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.threadedEnd).toBe(true);
    expect(plan.nut).toBeUndefined();
    expect(plan.grip).toBeCloseTo(2.5, 3);
    expect(plan.screwLength).toBeGreaterThanOrEqual(6);
    expect(plan.screwLength).toBeLessThanOrEqual(2.5 + 8.5);
    const headFace = bs.find((s) => s.pos.distanceTo(plan.head) < 1e-3 && s.normal.dot(plan.dir) < -0.999);
    expect(headFace, 'head sits on an exposed outer face of B').toBeDefined();
    expect(occ.has(headFace!)).toBe(false);

    // Fasten Joint: every screw head on an exposed face, every threaded tip inside the tapped hole
    const added = planJointFasteners(list, cat, null, 4).added;
    const screws = added.filter((i) => i.sku.startsWith('2800-'));
    expect(screws.length).toBeGreaterThanOrEqual(8);
    const allFaces = list.flatMap((i) => worldSnaps(i, cat[i.sku]));
    for (const sc of screws) {
      const head = new Vector3(...sc.position);
      const dir = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(...sc.quaternion));
      const f = allFaces.find((s) => s.pos.distanceTo(head) < 1e-3 && s.normal.dot(dir) < -0.999);
      expect(f, `screw ${sc.sku} head on a hole face`).toBeDefined();
      expect(occ.has(f!), `screw ${sc.sku} head not buried`).toBe(false);
    }
  });
});
