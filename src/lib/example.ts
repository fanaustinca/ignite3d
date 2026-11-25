// "Strafer-style" example drivetrain built only with the real snap + fasten logic, so loading it is
// also an end-to-end check that holes line up. Works with the real goBILDA catalogue (snap ids come from
// the STEP files, so everything is chosen by geometry) and with the procedural fallback catalogue.
import { Quaternion, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, SnapPoint } from '../types/cad';
import { anyPerp, compatible, mateTransform, toQuat, toVec3, worldSnaps, type WorldSnap } from './snap';
import { planJointFasteners, uid } from '../store/useCadStore';

type Cat = Record<string, CatalogPart>;
const pick = (cat: Cat, ...skus: string[]) => skus.find((s) => cat[s]) ?? skus[0];

export function exampleSkus(cat: Cat) {
  return {
    RAIL: '1120-0013-0336',
    // 13 holes = 336 mm: the end bores land on both rails and the ends finish flush with the rails' outer webs
    // (a longer channel would hang out over the wheels)
    CROSS: '1120-0013-0336',
    MOTOR: '5203-2402-0019',
    HUB: pick(cat, '1309-0016-4008', '1309-0016-0008'),
    WHEEL_L: pick(cat, '3614-0014-0096', '3601-0014-0096', '3625-0001-0096'),
    WHEEL_R: pick(cat, '3614-0014-0096', '3601-0014-0096', '3625-0002-0096'),
  };
}

const mk = (sku: string, p: Vector3, q: Quaternion, extra: Partial<PlacedInstance> = {}): PlacedInstance => ({
  instanceId: uid(),
  sku,
  position: toVec3(p),
  quaternion: toQuat(q),
  hidden: false,
  ghosted: false,
  ...extra,
});

const key = (p: Vector3) => `${Math.round(p.x * 20)},${Math.round(p.y * 20)},${Math.round(p.z * 20)}`;

/** Count ghost hole faces that land exactly on (opposed) hole faces of the target parts. */
function coincident(cand: PlacedInstance, part: CatalogPart, against: WorldSnap[]) {
  const set = new Map<string, WorldSnap[]>();
  for (const t of against) (set.get(key(t.pos)) ?? set.set(key(t.pos), []).get(key(t.pos))!).push(t);
  let n = 0;
  for (const s of worldSnaps(cand, part)) if ((set.get(key(s.pos)) ?? []).some((t) => t.normal.dot(s.normal) < -0.999)) n++;
  return n;
}

/** Try every (ghost snap × target snap × quarter turn) and keep the highest-scoring placement. */
function bestMate(cat: Cat, sku: string, ghostFilter: (s: SnapPoint) => boolean, targets: WorldSnap[], against: WorldSnap[], score: (c: PlacedInstance) => number = () => 0) {
  const part = cat[sku];
  let best: PlacedInstance | null = null;
  let bestScore = -Infinity;
  for (const t of targets)
    for (const g of part.snapPoints.filter((s) => ghostFilter(s) && compatible(s, t.snap)))
      for (let k = 0; k < 4; k++) {
        const m = mateTransform(g, t, (k * Math.PI) / 2);
        const cand = mk(sku, m.position, m.quaternion, { snapAxis: toVec3(t.normal), snapPivot: toVec3(t.pos) });
        const sc = coincident(cand, part, against) + score(cand);
        if (sc > bestScore) {
          bestScore = sc;
          best = cand;
        }
      }
  return best;
}

export function buildExampleRobot(cat: Cat): PlacedInstance[] {
  const S = exampleSkus(cat);
  for (const s of [S.RAIL, S.CROSS, S.MOTOR, S.HUB]) if (!cat[s]?.snapPoints.length) throw new Error(`example needs ${s} with snap points`);
  const out: PlacedInstance[] = [];
  const rx = (deg: number) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (deg * Math.PI) / 180);
  const near = (a: Vector3, b: Vector3, tol = 1e-3) => a.distanceTo(b) < tol;

  // side rails: web faces outward (±Z), flanges horizontal, bores at axle height (48 mm)
  const R1 = mk(S.RAIL, new Vector3(0, 48, -144), rx(90));
  const R2 = mk(S.RAIL, new Vector3(0, 48, 144), rx(-90));
  out.push(R1, R2);
  const r1 = worldSnaps(R1, cat[S.RAIL]);
  const r2 = worldSnaps(R2, cat[S.RAIL]);

  // cross members on the rails' top flanges, bore on bore, spanning to the far rail
  for (const x of [-120, 120]) {
    const t = r1.filter((s) => s.snap.type === 'bearing_14mm' && s.normal.y > 0.99 && Math.abs(s.pos.x - x) < 1e-3 && s.pos.y > 70);
    const reachesR2 = (c: PlacedInstance) =>
      worldSnaps(c, cat[S.CROSS]).some((s) => s.snap.type === 'bearing_14mm' && r2.some((q) => q.snap.type === 'bearing_14mm' && near(q.pos, s.pos))) ? 1000 : 0;
    const cross = bestMate(cat, S.CROSS, (s) => s.type === 'bearing_14mm' && s.normal[1] < -0.99, t, [...r1, ...r2], reachesR2);
    if (cross) out.push(cross);
  }

  // motors inside the rails, face on the web's inner face, shaft out through the 14 mm bore
  const wheelSpots: { hubTarget: { pos: Vector3; normal: Vector3; up: Vector3 }; axis: Vector3; side: number; x: number }[] = [];
  for (const [R, rs, side] of [[R1, r1, -1], [R2, r2, 1]] as const) {
    for (const x of [-144, 144]) {
      const inward = new Vector3(0, 0, -side);
      const bore = rs.find((s) => s.snap.type === 'bearing_14mm' && s.normal.dot(inward) > 0.99 && Math.abs(s.pos.x - x) < 1e-3 && Math.abs(s.pos.y - 48) < 1e-3);
      if (!bore) continue;
      const targets = rs.filter((s) => s.snap.type === 'm4_hole' && s.normal.dot(inward) > 0.99 && s.pos.distanceTo(bore.pos) < 13);
      const shaftThroughBore = (c: PlacedInstance) => {
        const sh = worldSnaps(c, cat[S.MOTOR]).find((s) => s.snap.male && (s.snap.type === 'rex_8mm' || s.snap.type === 'd_6mm'));
        return sh && sh.pos.distanceTo(bore.pos) < 1e-3 && sh.normal.dot(inward) < -0.99 ? 1000 : 0;
      };
      const motor = bestMate(cat, S.MOTOR, (s) => !s.male && s.type === 'm4_hole' && Math.abs(s.position[1]) < 0.05 && s.normal[1] > 0.99, targets, rs, shaftThroughBore);
      if (!motor) continue;
      out.push(motor);
      void R;
      const shaft = worldSnaps(motor, cat[S.MOTOR]).find((s) => s.snap.male && (s.snap.type === 'rex_8mm' || s.snap.type === 'd_6mm'))!;
      const d = shaft.normal.clone(); // points outward, along the shaft
      // hub clears the web AND the motor screw heads on its outer face (M4 socket head = 4 mm)
      const webT = 2.5;
      const headH = 4;
      wheelSpots.push({ hubTarget: { pos: shaft.pos.clone().addScaledVector(d, webT + headH + 1), normal: d.clone(), up: anyPerp(d) }, axis: d, side, x });
    }
  }

  // hubs on the shafts (threaded pattern face outward), wheels bolted to the hub pattern
  for (const w of wheelSpots) {
    const hub = cat[S.HUB];
    let bestHub: PlacedInstance | null = null;
    let bestOut = -Infinity;
    for (const g of hub.snapPoints.filter((s) => !s.male && s.type === cat[S.MOTOR].snapPoints.find((m) => m.male)?.type)) {
      const m = mateTransform(g, w.hubTarget, 0);
      const cand = mk(S.HUB, m.position, m.quaternion, { snapAxis: toVec3(w.axis), snapPivot: toVec3(w.hubTarget.pos) });
      // prefer the orientation whose pattern face is the outermost face along the shaft
      const pat = worldSnaps(cand, hub).filter((s) => s.snap.type === 'hub_pattern_16mm' && s.normal.dot(w.axis) > 0.99);
      const outMost = pat.length ? Math.max(...pat.map((s) => s.pos.dot(w.axis))) : -1e9;
      if (outMost > bestOut) {
        bestOut = outMost;
        bestHub = cand;
      }
    }
    if (!bestHub) continue;
    out.push(bestHub);
    const hubSnaps = worldSnaps(bestHub, hub);
    const face = hubSnaps.filter((s) => s.snap.type === 'hub_pattern_16mm' && s.normal.dot(w.axis) > 0.99);
    const wheelSku = w.x * w.side > 0 ? S.WHEEL_L : S.WHEEL_R;
    if (!cat[wheelSku]?.snapPoints.length) continue;
    const axisLine = (c: PlacedInstance) => {
      // the wheel's 14 mm bore / REX bore must sit on the shaft axis
      const bores = worldSnaps(c, cat[wheelSku]).filter((s) => s.snap.type === 'bearing_14mm' || s.snap.type === 'rex_8mm');
      return bores.some((b) => b.pos.clone().sub(w.hubTarget.pos).cross(w.axis).length() < 1e-3) ? 500 : 0;
    };
    const wheel = bestMate(cat, wheelSku, (s) => !s.male && s.type === 'm4_hole', face, hubSnaps, axisLine);
    if (wheel) out.push(wheel);
  }

  out.push(...planJointFasteners(out, cat, null, 4).added);
  return out;
}
