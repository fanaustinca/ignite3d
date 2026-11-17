// "Strafer-style" example drivetrain built only with the real snap + fasten logic,
// so loading it is also an end-to-end check that holes line up.
import { Quaternion, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance } from '../types/cad';
import { mateTransform, toQuat, toVec3, worldSnaps, type WorldSnap, anyPerp } from './snap';
import { planJointFasteners, uid } from '../store/useCadStore';

const RAIL = '1120-0013-0336';
const CROSS = '1120-0015-0384';
const MOTOR = '5203-2402-0019';
const HUB = '1309-0016-0008';
const WHEEL_L = '3625-0001-0096';
const WHEEL_R = '3625-0002-0096';

type Cat = Record<string, CatalogPart>;
const mk = (sku: string, p: Vector3, q: Quaternion, extra: Partial<PlacedInstance> = {}): PlacedInstance => ({
  instanceId: uid(),
  sku,
  position: toVec3(p),
  quaternion: toQuat(q),
  hidden: false,
  ghosted: false,
  ...extra,
});

/** Try every (ghost snap × 90° rotation) and keep the placement that lines up the most holes. */
function bestMate(cat: Cat, sku: string, ghostFilter: (s: WorldSnap['snap']) => boolean, target: { pos: Vector3; normal: Vector3; up: Vector3 }, against: PlacedInstance[], score?: (cand: PlacedInstance) => number) {
  const part = cat[sku];
  const targetSnaps = against.flatMap((a) => worldSnaps(a, cat[a.sku]));
  let best: PlacedInstance | null = null;
  let bestScore = -Infinity;
  for (const g of part.snapPoints.filter(ghostFilter))
    for (let k = 0; k < 4; k++) {
      const m = mateTransform(g, target, (k * Math.PI) / 2);
      const cand = mk(sku, m.position, m.quaternion, { snapAxis: toVec3(target.normal), snapPivot: toVec3(target.pos) });
      const mine = worldSnaps(cand, part);
      let sc = 0;
      for (const s of mine) if (targetSnaps.some((t) => t.pos.distanceTo(s.pos) < 1e-4 && t.normal.dot(s.normal) < -0.999)) sc++;
      if (score) sc += score(cand);
      if (sc > bestScore) {
        bestScore = sc;
        best = cand;
      }
    }
  return best!;
}

export function buildExampleRobot(cat: Cat): PlacedInstance[] {
  const out: PlacedInstance[] = [];
  const rx = (deg: number) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (deg * Math.PI) / 180);
  // side rails: web faces outward, flanges horizontal, bores at axle height (48 mm)
  const R1 = mk(RAIL, new Vector3(0, 48, -144), rx(90));
  const R2 = mk(RAIL, new Vector3(0, 48, 144), rx(-90));
  out.push(R1, R2);

  // cross members sitting on the rails' top flanges, bore-on-bore
  for (const x of [-120, 120]) {
    const t = worldSnaps(R1, cat[RAIL]).find((s) => s.snap.type === 'bearing_14mm' && s.normal.y > 0.99 && Math.abs(s.pos.x - x) < 1e-6)!;
    const r2 = worldSnaps(R2, cat[RAIL]);
    const cross = bestMate(cat, CROSS, (s) => s.type === 'bearing_14mm' && s.normal[1] === -1 && Math.abs(s.position[0] + 144) < 1e-6, t, [R1, R2], (cand) =>
      // must span across to the far rail's top flange, bore on bore
      worldSnaps(cand, cat[CROSS]).some((s) => s.snap.type === 'bearing_14mm' && r2.some((q) => q.snap.type === 'bearing_14mm' && q.pos.distanceTo(s.pos) < 1e-4)) ? 1000 : 0,
    );
    out.push(cross);
  }

  // motors inside the rails, shafts out through the 14mm bores
  const wheels: [PlacedInstance, number, number][] = [];
  for (const R of [R1, R2]) {
    const rp = cat[RAIL];
    const inward = R === R1 ? 1 : -1;
    for (const x of [-144, 144]) {
      const bore = worldSnaps(R, rp).find((s) => s.snap.type === 'bearing_14mm' && s.normal.z * inward > 0.99 && Math.abs(s.pos.x - x) < 1e-6)!;
      const hole = worldSnaps(R, rp).find(
        (s) => s.snap.type === 'm4_hole' && s.normal.z * inward > 0.99 && Math.abs(s.pos.x - (x - 8)) < 1e-6 && Math.abs(s.pos.y - 40) < 1e-6,
      )!;
      const motor = bestMate(cat, MOTOR, (s) => s.id.startsWith('face'), hole, [R], (cand) => {
        const sh = worldSnaps(cand, cat[MOTOR]).find((s) => s.snap.id === 'shaft')!;
        return sh.pos.distanceTo(bore.pos) < 1e-4 ? 10 : 0;
      });
      out.push(motor);
      const shaft = worldSnaps(motor, cat[MOTOR]).find((s) => s.snap.id === 'shaft')!;
      const d = shaft.normal.clone();
      // hub: boss toward the rail, 0.5 mm clearance from the web's outer face
      const virt = { pos: shaft.pos.clone().addScaledVector(d, 2.5 + 0.5), normal: d.clone(), up: anyPerp(d) };
      const hubSnap = cat[HUB].snapPoints.find((s) => s.id === 'boreb')!;
      const hm = mateTransform(hubSnap, virt, 0);
      const hub = mk(HUB, hm.position, hm.quaternion, { snapAxis: toVec3(d), snapPivot: toVec3(virt.pos) });
      out.push(hub);
      wheels.push([hub, x, R === R1 ? -1 : 1]);
    }
  }

  // mecanum wheels bolted to the hub patterns (X pattern when viewed from above)
  for (const [hub, x, side] of wheels) {
    const sku = x * side > 0 ? WHEEL_L : WHEEL_R;
    const hubFaces = worldSnaps(hub, cat[HUB]).filter((s) => s.snap.type === 'hub_pattern_16mm');
    const outward = new Vector3(0, 0, side);
    const t = hubFaces.find((s) => s.normal.dot(outward) > 0.99)!;
    const wheel = bestMate(cat, sku, (s) => s.type === 'm4_hole' && s.normal[0] === -1, t, [hub]);
    out.push(wheel);
  }

  const fast = planJointFasteners(out, cat, null, 4);
  out.push(...fast.added);
  return out;
}
