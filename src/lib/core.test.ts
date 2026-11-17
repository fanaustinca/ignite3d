import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { PROCEDURAL_CATALOG as BUILTIN_CATALOG } from '../data/catalog';
import { triangulateExtrusion, frameNormal, mapPoint, holePts } from '../geometry/recipe';
import type { CatalogPart, PlacedInstance } from '../types/cad';
import { compatible, mateTransform, toQuat, toVec3, v3, worldSnaps, distToLine } from './snap';
import { planFasten } from './fasten';

const bySku = new Map(BUILTIN_CATALOG.map((p) => [p.sku, p]));
const part = (sku: string) => {
  const p = bySku.get(sku);
  if (!p) throw new Error('missing ' + sku);
  return p;
};
const inst = (id: string, sku: string, pos = new Vector3(), q = new Quaternion()): PlacedInstance => ({
  instanceId: id,
  sku,
  position: toVec3(pos),
  quaternion: toQuat(q),
  hidden: false,
  ghosted: false,
});
function snapOnto(id: string, ghostSku: string, ghostSnapId: string, target: PlacedInstance, targetSnapId: string, angle = 0) {
  const g = part(ghostSku).snapPoints.find((s) => s.id === ghostSnapId)!;
  const t = worldSnaps(target, part(target.sku)).find((s) => s.snap.id === targetSnapId)!;
  const m = mateTransform(g, t, angle);
  return inst(id, ghostSku, m.position, m.quaternion);
}
const allSnaps = (insts: PlacedInstance[]) => insts.flatMap((i) => worldSnaps(i, part(i.sku)));

describe('catalog', () => {
  it('has the full seed catalog with valid 12-digit SKUs', () => {
    expect(BUILTIN_CATALOG.length).toBeGreaterThanOrEqual(95);
    const skus = new Set<string>();
    for (const p of BUILTIN_CATALOG) {
      expect(p.sku, p.name).toMatch(/^\d{4}-\d{4}-\d{4}$/);
      expect(skus.has(p.sku), p.sku).toBe(false);
      skus.add(p.sku);
      expect(p.massGrams).toBeGreaterThan(0);
      expect(p.priceUsd).toBeGreaterThan(0);
    }
    for (const sku of ['1120-0001-0048', '1120-0017-0432', '5203-2402-0019', '2800-0004-0010', '2810-0004-0001'])
      expect(skus.has(sku), sku).toBe(true);
  });

  it('every procedural solid is a closed, consistently-wound mesh', () => {
    for (const p of BUILTIN_CATALOG)
      for (const e of p.procedural!.solids) {
        const arr: number[] = [];
        triangulateExtrusion(e, arr);
        const key = (i: number) => `${arr[i].toFixed(4)},${arr[i + 1].toFixed(4)},${arr[i + 2].toFixed(4)}`;
        const edges = new Map<string, number>();
        for (let t = 0; t < arr.length; t += 9) {
          const k = [key(t), key(t + 3), key(t + 6)];
          for (let j = 0; j < 3; j++) {
            const a = k[j], b = k[(j + 1) % 3];
            edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
          }
        }
        for (const [e2, n] of edges) {
          const [a, b] = e2.split('|');
          expect(n, `${p.sku} dup edge`).toBe(1);
          expect(edges.get(`${b}|${a}`), `${p.sku} open edge`).toBe(1);
        }
      }
  });

  it('every hole snap point sits inside a real cut hole, on a real face', () => {
    let checked = 0;
    for (const p of BUILTIN_CATALOG)
      p.procedural!.solids.forEach((e, si) => {
        const n = frameNormal(e);
        (e.holes ?? []).forEach((h, hi) => {
          const snaps = p.snapPoints.filter((s) => s.holeId === `s${si}h${hi}`);
          for (const s of snaps) {
            // snap lies at the hole centre on one of the two faces
            const c0 = mapPoint(e, h.x, h.y, 0);
            const c1 = mapPoint(e, h.x, h.y, e.depth);
            const d0 = v3(s.position).distanceTo(v3(c0));
            const d1 = v3(s.position).distanceTo(v3(c1));
            expect(Math.min(d0, d1), `${p.sku} ${s.id}`).toBeLessThan(1e-3);
            expect(Math.abs(Math.abs(v3(s.normal).dot(v3(n))) - 1)).toBeLessThan(1e-4);
            // hole polygon really surrounds the centre (cut is present and centred)
            const pts = holePts(h);
            const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
            const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
            expect(Math.hypot(cx - h.x, cy - h.y)).toBeLessThan(0.3);
            checked++;
          }
        });
      });
    expect(checked).toBeGreaterThan(2000);
  });

  it('holes never break through a part edge or overlap each other', () => {
    for (const p of BUILTIN_CATALOG)
      for (const e of p.procedural!.solids) {
        if (e.outline.kind !== 'poly') continue;
        const xs = e.outline.pts.map((q) => q[0]);
        const ys = e.outline.pts.map((q) => q[1]);
        const isRect = e.outline.pts.length === 4;
        const holes = e.holes ?? [];
        holes.forEach((h, i) => {
          if (isRect) {
            expect(h.x - h.d / 2, p.sku).toBeGreaterThan(Math.min(...xs) + 0.4);
            expect(h.x + h.d / 2, p.sku).toBeLessThan(Math.max(...xs) - 0.4);
            expect(h.y - h.d / 2, p.sku).toBeGreaterThan(Math.min(...ys) + 0.4);
            expect(h.y + h.d / 2, p.sku).toBeLessThan(Math.max(...ys) - 0.4);
          }
          for (let j = i + 1; j < holes.length; j++) {
            const g = holes[j];
            const gap = Math.hypot(h.x - g.x, h.y - g.y) - (h.d / 2 + g.d / 2) * 1.16;
            expect(gap, `${p.sku} holes ${i}/${j} overlap`).toBeGreaterThan(0.3);
          }
        });
      }
  });
});

describe('snapping', () => {
  it('mate transform: positions coincide, normals oppose, for arbitrary targets', () => {
    const g = part('1120-0005-0144').snapPoints.find((s) => s.type === 'm4_hole')!;
    for (let i = 0; i < 25; i++) {
      const n = new Vector3(Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 0.3)).normalize();
      const up = new Vector3(1, 2, 3).cross(n).normalize();
      const target = { pos: new Vector3(i, -i * 2, 7), normal: n, up };
      const m = mateTransform(g, target, (i * Math.PI) / 4);
      const p = v3(g.position).applyQuaternion(m.quaternion).add(m.position);
      expect(p.distanceTo(target.pos)).toBeLessThan(1e-9);
      expect(v3(g.normal).applyQuaternion(m.quaternion).dot(n)).toBeCloseTo(-1, 9);
    }
  });

  it('two channels snapped bore-to-bore have every overlapping hole aligned', () => {
    const A = inst('A', '1120-0005-0144');
    const aBore = part(A.sku).snapPoints.find((s) => s.type === 'bearing_14mm' && s.normal[1] === -1)!;
    const bBore = part(A.sku).snapPoints.find((s) => s.type === 'bearing_14mm' && s.normal[1] === -1 && s.position[0] === aBore.position[0])!;
    const B = snapOnto('B', A.sku, bBore.id, A, aBore.id);
    const aw = worldSnaps(A, part(A.sku)).filter((s) => Math.abs(s.pos.y + 24) < 1e-6);
    const bw = worldSnaps(B, part(B.sku)).filter((s) => Math.abs(s.pos.y + 24) < 1e-6);
    expect(bw.length).toBe(aw.length);
    for (const b of bw) {
      const match = aw.find((a) => a.pos.distanceTo(b.pos) < 1e-6 && a.snap.type === b.snap.type);
      expect(match, `B hole ${b.snap.id} at ${b.pos.toArray()}`).toBeTruthy();
      expect(match!.normal.dot(b.normal)).toBeCloseTo(-1, 9);
    }
  });

  it('rotating 90° about the snapped hole keeps holes on the 8mm grid', () => {
    const A = inst('A', '1120-0005-0144');
    const aS = part(A.sku).snapPoints.find((s) => s.type === 'bearing_14mm' && s.normal[1] === -1)!;
    const B = snapOnto('B', '1120-0003-0096', part('1120-0003-0096').snapPoints.find((s) => s.type === 'bearing_14mm' && s.normal[1] === -1)!.id, A, aS.id, Math.PI / 2);
    const aw = worldSnaps(A, part(A.sku)).filter((s) => Math.abs(s.pos.y + 24) < 1e-6 && s.snap.type === 'm4_hole');
    const bw = worldSnaps(B, part(B.sku)).filter((s) => Math.abs(s.pos.y + 24) < 1e-6 && s.snap.type === 'm4_hole');
    // 16mm square around the shared bore must coincide in a crossed joint
    const shared = bw.filter((b) => aw.some((a) => a.pos.distanceTo(b.pos) < 1e-6));
    expect(shared.length).toBeGreaterThanOrEqual(4);
  });

  it('male screws only mate with holes, never with other males', () => {
    const s = part('2800-0004-0010').snapPoints[0];
    const shaft = part('2106-0008-0096').snapPoints[0];
    const hole = part('1120-0001-0048').snapPoints.find((x) => x.type === 'm4_hole')!;
    expect(compatible(s, hole)).toBe(true);
    expect(compatible(s, part('2800-0004-0012').snapPoints[0])).toBe(false);
    expect(compatible(shaft, hole)).toBe(false);
  });

  it('motor face snapped to a channel puts the shaft through the 14mm bore', () => {
    const A = inst('A', '1120-0003-0096');
    const motor = part('5203-2402-0019');
    const face0 = motor.snapPoints.find((s) => s.id === 'face0')!; // at (-8, 0, -8)
    // channel bottom outer face hole at (-8, -24, -8) around the centre bore at x=0
    const tgt = worldSnaps(A, part(A.sku)).find(
      (s) => s.snap.type === 'm4_hole' && s.normal.y === -1 && s.pos.distanceTo(new Vector3(-8, -24, 8)) < 1e-6,
    )!;
    expect(tgt).toBeTruthy();
    // try the 4 rotations, pick the one where all 4 face holes land on channel holes
    let best = 0;
    let M: PlacedInstance | null = null;
    for (let k = 0; k < 4; k++) {
      const m = mateTransform(face0, tgt, (k * Math.PI) / 2);
      const cand = inst('M', motor.sku, m.position, m.quaternion);
      const faces = worldSnaps(cand, motor).filter((s) => s.snap.id.startsWith('face'));
      const hits = faces.filter((f) => worldSnaps(A, part(A.sku)).some((a) => a.pos.distanceTo(f.pos) < 1e-6)).length;
      if (hits > best) {
        best = hits;
        M = cand;
      }
    }
    expect(best).toBe(4);
    const shaft = worldSnaps(M!, motor).find((s) => s.snap.id === 'shaft')!;
    const bore = worldSnaps(A, part(A.sku)).find((s) => s.snap.type === 'bearing_14mm' && s.normal.y === -1 && Math.abs(s.pos.x) < 1e-6)!;
    expect(distToLine(bore.pos, shaft.pos, shaft.normal)).toBeLessThan(1e-6);
    expect(shaft.normal.y).toBeCloseTo(1, 9); // shaft points up through the channel
  });
});

describe('smart fasten', () => {
  function stackedChannels() {
    const A = inst('A', '1120-0005-0144');
    const aBore = part(A.sku).snapPoints.find((s) => s.type === 'bearing_14mm' && s.normal[1] === -1)!;
    const B = snapOnto('B', A.sku, aBore.id, A, aBore.id);
    return [A, B];
  }

  it('two 2.5mm channel webs -> 10mm screw + locknut on the far face', () => {
    const insts = stackedChannels();
    const snaps = allSnaps(insts);
    const click = snaps.find((s) => s.instanceId === 'A' && s.snap.type === 'm4_hole' && s.normal.y === 1 && Math.abs(s.pos.y + 21.5) < 1e-6)!;
    const plan = planFasten(click, snaps);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.grip).toBeCloseTo(5, 6);
    expect(plan.screwLength).toBe(10);
    expect(plan.threadedEnd).toBe(false);
    expect(plan.layers.map((l) => l.instanceId)).toEqual(['A', 'B']);
    // head on A's inner face, nut on B's inner face (y = -26.5)
    expect(plan.screw.position[1]).toBeCloseTo(-21.5, 6);
    expect(plan.nut!.position[1]).toBeCloseTo(-26.5, 6);
    // screw shank points down, through the hole axis
    const shankDir = new Vector3(0, -1, 0).applyQuaternion(new Quaternion(...plan.screw.quaternion));
    expect(shankDir.y).toBeCloseTo(-1, 9);
    expect(plan.screw.position[0]).toBeCloseTo(click.pos.x, 6);
    expect(plan.screw.position[2]).toBeCloseTo(click.pos.z, 6);
  });

  it('clicking the inner contact face still puts the head on the outermost face', () => {
    const insts = stackedChannels();
    const snaps = allSnaps(insts);
    // B's top face (y=-24, normal +y) is pressed against A — clicking it should walk out to A's inner face
    const click = snaps.find((s) => s.instanceId === 'B' && s.snap.type === 'm4_hole' && s.normal.y === 1 && Math.abs(s.pos.y + 24) < 1e-6)!;
    const plan = planFasten(click, snaps);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.screw.position[1]).toBeCloseTo(-21.5, 6);
      expect(plan.screwLength).toBe(10);
    }
  });

  it('a lone part cannot be fastened', () => {
    const A = inst('A', '1120-0005-0144');
    const snaps = allSnaps([A]);
    const plan = planFasten(snaps.find((s) => s.snap.type === 'm4_hole')!, snaps);
    expect(plan.ok).toBe(false);
  });

  it('channel on a motor face -> 8mm screw into the tapped hole, no nut', () => {
    const motor = inst('M', '5203-2402-0019');
    const mp = part(motor.sku);
    const ch = part('1120-0003-0096');
    const chHole = ch.snapPoints.find((s) => s.type === 'm4_hole' && s.normal[1] === -1 && s.position[0] === -8 && s.position[2] === 8)!;
    const C = snapOnto('C', ch.sku, chHole.id, motor, 'face0');
    const snaps = allSnaps([motor, C]);
    // find the channel's inner face hole above face0
    const f0 = worldSnaps(motor, mp).find((s) => s.snap.id === 'face0')!;
    const click = snaps.find((s) => s.instanceId === 'C' && s.normal.y > 0.99 && s.snap.type === 'm4_hole' && Math.hypot(s.pos.x - f0.pos.x, s.pos.z - f0.pos.z) < 1e-6)!;
    expect(click).toBeTruthy();
    const plan = planFasten(click, snaps);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.threadedEnd).toBe(true);
      expect(plan.nut).toBeUndefined();
      expect(plan.grip).toBeCloseTo(2.5, 6);
      expect(plan.screwLength).toBe(8);
    }
    // starting from the channel face that touches the motor must give the same joint
    const inner = snaps.find((s) => s.instanceId === 'C' && s.normal.y < -0.99 && s.snap.type === 'm4_hole' && Math.hypot(s.pos.x - f0.pos.x, s.pos.z - f0.pos.z) < 1e-6)!;
    const plan2 = planFasten(inner, snaps);
    expect(plan2.ok).toBe(true);
    if (plan2.ok && plan.ok) {
      expect(plan2.threadedEnd).toBe(true);
      expect(plan2.screw.position).toEqual(plan.screw.position);
    }
  });

  it('channel + 1mm washer + flat beam -> grip 6.3mm -> 12mm screw', () => {
    const A = inst('A', '1120-0003-0096');
    const ap = part(A.sku);
    const aTop = worldSnaps(A, ap).find((s) => s.snap.type === 'm4_hole' && s.normal.y === 1 && Math.abs(s.pos.y + 21.5) < 1e-6 && s.pos.x === -8 && s.pos.z === -8)!;
    const W = snapOnto('W', '2801-0004-0001', 's0h0b', A, aTop.snap.id);
    const wTop = worldSnaps(W, part(W.sku)).find((s) => s.normal.y > 0.99)!;
    const fb = part('1102-0003-0048');
    const fbHole = fb.snapPoints.find((s) => s.normal[1] === -1)!;
    const F = snapOnto('F', fb.sku, fbHole.id, W, wTop.snap.id);
    const snaps = allSnaps([A, W, F]);
    const click = worldSnaps(F, fb).find((s) => s.normal.y > 0.99 && s.pos.distanceTo(new Vector3(wTop.pos.x, s.pos.y, wTop.pos.z)) < 1e-6)!;
    const plan = planFasten(click, snaps);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.grip).toBeCloseTo(2.5 + 0.8 + 3, 6);
      expect(plan.screwLength).toBe(12);
      expect(plan.layers.length).toBe(3);
    }
  });
});

// keep type import used
export type _P = CatalogPart;
