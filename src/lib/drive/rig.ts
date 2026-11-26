// Live Test (beta): turn a CAD build into a "rig" a physics sim can drive.
//
// Parts are merged into rigid bodies (bolted joints, bearings in their seats, hubs locked on shafts, anything
// touching), then bodies are linked by revolute joints (shaft in a bearing / 14 mm bore, motor output, servo
// spline). Gears in mesh and chains/belts between coplanar sprockets/pulleys couple joint speeds. Motors and
// servos drive what they turn; wheels touching the floor become the drivetrain.
//
// Everything is tolerant: aligned holes count as joined even without screws, parts that are not attached to
// anything ride along with whatever they touch (or the chassis), and anything that can't be understood is held
// fixed and listed in `notes` instead of failing.
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance } from '../../types/cad';
import { distToLine, instanceMatrix, q4, v3, worldSnaps, type WorldSnap } from '../snap';
import { plausibleMesh, spinAxisLocal, spinCentreLocal, toothCentreLocal, toothInfo, type ToothInfo } from './partInfo';
import { isChainSku, resolveChains, type ResolvedChain } from '../chain';

// ------------------------------------------------------------------ part classes
const pre = (sku: string, l: string[]) => l.some((p) => sku.startsWith(p));
export const isScrew = (p: CatalogPart) => pre(p.sku, ['2800-', '2802-', '2804-', '2813-', '2822-']) || (/screw/i.test(p.name) && p.category === 'Fasteners & Spacers' && !/lead screw/i.test(p.name));
export const isNut = (p: CatalogPart) => /lock ?nut|\bnut\b/i.test(p.name) && !/lead screw|gorail|hurricane/i.test(p.name);
// (a "REX Shaft with E-Clip" is a shaft, not an e-clip)
export const isHardware = (p: CatalogPart) => isScrew(p) || isNut(p) || (/washer|set screw|shim|e-clip|retaining ring/i.test(p.name) && !/shaft|standoff|spacer/i.test(p.name));
export const isShaft = (p: CatalogPart) => pre(p.sku, ['2100-', '2101-', '2102-', '2105-', '2106-', '2109-', '2110-', '3501-', '1910-', '1911-', '1922-', '1923-']) || /\bshaft\b/i.test(p.name) && !/motor|coupler|collar|hub(?! shaft)|bearing|spacer/i.test(p.name);
export const isBearing = (p: CatalogPart) => /^16\d\d-/.test(p.sku) || /bearing|pillow/i.test(p.name);
export const isMotor = (p: CatalogPart) => p.category === 'Motors & Servos' && /motor/i.test(p.name) && !/mount|bracket|horn|arm|clamp|cable|encoder only/i.test(p.name);
export const isServo = (p: CatalogPart) => p.category === 'Motors & Servos' && /servo\b/i.test(p.name) && !/plate|frame|bracket|arm|hub|shaft|horn|spline|block|mount|extension|cable|programmer|tester/i.test(p.name);
const isSpline = (p: CatalogPart) => /spline/i.test(p.name);
const isSlide = (p: CatalogPart) => /viper|linear slide|slide kit|slide rail|drawer slide/i.test(p.name);

/** Free speed (RPM at 12 V) and stall torque (N·m) of a goBILDA-style planetary motor, from its name. */
export function motorSpec(p: CatalogPart) {
  const rpm = Number(/([\d.]+)\s*RPM/i.exec(p.name)?.[1]) || 312;
  // 5203/5202 Yellow Jacket: stall ≈ 0.155 N·m at the 6000 RPM motor, × gear ratio, ~85 % gearbox efficiency
  const ratio = 6000 / rpm;
  return { rpm, freeRadS: (rpm * 2 * Math.PI) / 60, stallNm: 0.155 * ratio * 0.85 };
}
export function servoSpec(p: CatalogPart) {
  const n = p.name;
  const range = /5-Turn/i.test(n) ? 1800 : /180°/.test(n) ? 180 : /Axon/i.test(n) ? 355 : 300;
  const degPerS = /Super Speed/i.test(n) ? 1100 : /Speed/i.test(n) ? 600 : 290;
  return { rangeDeg: range, degPerS, continuous: false };
}

export interface WheelInfo {
  radius: number; // mm
  width: number; // mm
  mecanum: 0 | 1 | -1; // hand: +1 = Left (FL/BR), -1 = Right
  omni: boolean;
  /** Squish (mm) of the tread: gecko / soft intake wheels give a lot. */
  squish: number;
}
export function wheelInfo(p: CatalogPart): WheelInfo | null {
  if (p.category !== 'Wheels' && !/wheel|roller/i.test(p.name)) return null;
  const b = p.bounds ?? [[-10, -10, -10], [10, 10, 10]];
  const radius = Math.max(b[1][1] - b[0][1], b[1][2] - b[0][2]) / 2;
  const width = b[1][0] - b[0][0];
  const n = p.name;
  const mec = /mecanum/i.test(n);
  // drive mecanum: Left/Right by the FTC convention (Left = front-left & back-right); Vector intake wheels name the
  // slant the other way round (their STEPs measure Right-Slant = +1)
  const hand: 0 | 1 | -1 = !mec ? 0 : /Right-Slant/i.test(n) ? 1 : /Left-Slant/i.test(n) ? -1 : /\bRight\b/i.test(n) ? -1 : 1;
  const duro = Number(/(\d+)A Durometer/i.exec(n)?.[1]) || (/gecko|compliant|intake/i.test(n) ? 30 : 70);
  const softness = duro <= 20 ? 0.22 : duro <= 35 ? 0.16 : duro <= 50 ? 0.08 : 0.03;
  return { radius, width, mecanum: hand, omni: /omni/i.test(n), squish: Math.min(8, radius * softness) };
}

// ------------------------------------------------------------------ rig types
export interface RigPart {
  instanceId: string;
  sku: string;
  part: CatalogPart;
  inst: PlacedInstance;
}
export interface RigBody {
  id: number;
  parts: RigPart[];
  mass: number; // g
  /** Parent body (null = chassis). */
  parent: number | null;
  /** Revolute joint to the parent, in CAD world coordinates at rest (mm). */
  axis?: Vector3;
  pivot?: Vector3;
  /** What drives this joint. */
  drive?: { actuator: number; ratio: number };
  /** Everything on it is round about the joint axis (wheels, rollers, gears, hubs): it spins, never "moves". */
  round: boolean;
  /** Drive wheels on this body (touching the floor). */
  wheels: RigWheel[];
  /** Intake-style rollers (wheels not on the floor) that grab game elements. */
  rollers: RigRoller[];
  label: string;
}
export interface RigWheel {
  instanceId: string;
  info: WheelInfo;
  /** Wheel centre and axle in CAD world (mm, at rest). */
  centre: Vector3;
  axle: Vector3;
  /** Roller direction at the floor for mecanum (world, at rest), unit, in the ground plane. */
  roller?: Vector3;
}
export interface RigRoller {
  instanceId: string;
  centre: Vector3;
  axle: Vector3;
  radius: number;
  width: number;
  squish: number;
}
export interface Actuator {
  id: number;
  kind: 'motor' | 'servo';
  instanceId: string;
  name: string;
  /** body that the motor output / servo spline turns (null: nothing attached) */
  body: number | null;
  role: 'drive' | 'spinner' | 'arm' | 'idle';
  label: string;
  freeRadS: number;
  stallNm: number;
  rangeDeg?: number;
  degPerS?: number;
}
export interface Coupling {
  a: number;
  b: number;
  /** ω_b = ratio · ω_a (relative to their parents) */
  ratio: number;
  kind: 'gear' | 'chain' | 'belt' | 'miter';
}
export interface Rig {
  bodies: RigBody[];
  actuators: Actuator[];
  couplings: Coupling[];
  /** Lowest point of the robot (mm, CAD world Y). */
  groundY: number;
  /** Robot mass (g) and centre of gravity (CAD world mm). */
  mass: number;
  cog: Vector3;
  drive: { kind: 'mecanum' | 'tank' | 'omni' | 'x-drive' | 'swerve?' | 'none'; wheels: number; motors: number };
  /** Chains drawn with the Chain tool, with the bodies of their two sprockets. */
  chains: { rc: ResolvedChain; a: number; b: number }[];
  notes: string[];
}

export type RoleOverride = 'spinner' | 'arm';
export interface RigOptions {
  /** Per motor / servo instance id: what the user says it is (beats the guess). */
  roles?: Record<string, RoleOverride>;
}

class DSU {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.p[x] !== x) x = this.p[x] = this.p[this.p[x]];
    return x;
  }
  union(a: number, b: number, why = '') {
    if ((globalThis as { __rigDebug?: (a: number, b: number, why: string) => void }).__rigDebug) (globalThis as unknown as { __rigDebug: (a: number, b: number, why: string) => void }).__rigDebug(a, b, why);
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p[ra] = rb;
  }
}

const BOLT = new Set(['m4_hole', 'hub_pattern_16mm']);
const BORE = new Set(['rex_8mm', 'd_6mm']);

interface Node {
  rp: RigPart;
  snaps: WorldSnap[];
  box: Box3;
  m: Matrix4;
  q: Quaternion;
}

/** Shaft axis of a shaft-like part: its Y axis (shafts / standoffs are canonical along Y). */
function shaftAxis(n: Node) {
  const b = n.rp.part.bounds;
  const d = new Vector3(0, 1, 0).applyQuaternion(n.q).normalize();
  return { o: v3(n.rp.inst.position), d, lo: b ? b[0][1] : -20, hi: b ? b[1][1] : 20 };
}

export function buildRig(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, opts: RigOptions = {}): Rig {
  const notes: string[] = [];
  const nodes: Node[] = [];
  for (const inst of instances) {
    if (inst.hidden || isChainSku(inst.sku)) continue;
    const part = catalog[inst.sku];
    if (!part) continue;
    const m = instanceMatrix(inst);
    const b = part.bounds ? new Box3(v3(part.bounds[0]), v3(part.bounds[1])) : new Box3().setFromCenterAndSize(new Vector3(), v3(part.dimensions ?? [10, 10, 10]));
    nodes.push({ rp: { instanceId: inst.instanceId, sku: inst.sku, part, inst }, snaps: worldSnaps(inst, part), box: b.applyMatrix4(m), m, q: q4(inst.quaternion) });
  }
  const N = nodes.length;
  // virtual nodes: one "output" per motor/servo (the shaft/spline that turns)
  const outOf = new Map<number, number>();
  const actuatorNodes: number[] = [];
  nodes.forEach((n, i) => {
    if (isMotor(n.rp.part) || isServo(n.rp.part)) {
      outOf.set(i, N + actuatorNodes.length);
      actuatorNodes.push(i);
    }
  });
  const total = N + actuatorNodes.length;
  const rigid = new DSU(total);
  const hw = nodes.map((n) => isHardware(n.rp.part));

  // ---- 1. face contacts on coincident, opposed snaps: bolted / seated / stacked parts are one body
  const cell = (p: Vector3) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
  const grid = new Map<string, { i: number; s: WorldSnap }[]>();
  nodes.forEach((n, i) => {
    if (hw[i]) return;
    for (const s of n.snaps) {
      const k = cell(s.pos);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push({ i, s });
    }
  });
  const revolute: { a: number; b: number; o: Vector3; d: Vector3 }[] = [];
  const bearingLike = (i: number) => isBearing(nodes[i].rp.part);
  // a screw through a hole: those two parts really are bolted together
  const screwBoxes = nodes.filter((n) => isScrew(n.rp.part)).map((n) => n.box.clone().expandByScalar(0.4));
  const screwed = (p: Vector3) => screwBoxes.some((b) => b.containsPoint(p));
  // parts that sit on a shaft and can turn (wheels, gears, hubs, spacers, collars…)
  const ROUNDISH = /hub|spacer|collar|coupler|wheel|roller|gear|sprocket|pulley/i;
  const roundish = (i: number) => !isShaft(nodes[i].rp.part) && !isMotor(nodes[i].rp.part) && (!!wheelInfo(nodes[i].rp.part) || !!toothInfo(nodes[i].rp.part) || ROUNDISH.test(nodes[i].rp.part.name));
  const axisCache = new Map<number, { c: Vector3; d: Vector3 }>();
  const spinLine = (i: number) => {
    let a = axisCache.get(i);
    if (!a) {
      const part = nodes[i].rp.part;
      const axL = spinAxisLocal(part);
      a = { c: spinCentreLocal(part, axL).applyMatrix4(nodes[i].m), d: axL.applyQuaternion(nodes[i].q).normalize() };
      axisCache.set(i, a);
    }
    return a;
  };
  const boreOn = (j: number, c: Vector3, d: Vector3) => nodes[j].snaps.some((t) => t.snap.type !== 'm4_hole' && !t.snap.male && Math.abs(t.normal.dot(d)) > 0.995 && distToLine(t.pos, c, d) < 1);
  /**
   * i turns against j: i is round, j holds a bearing on i's axis (a hub / wheel / spacer stacked against the
   * plate its shaft runs through spins; it is not bolted to it unless a screw says so).
   */
  const spinsAgainst = (i: number, j: number) => {
    if (!roundish(i) || (roundish(j) && !bearingLike(j))) return false;
    const { c, d } = spinLine(i);
    if (!boreOn(j, c, d)) return false;
    if (bearingLike(j)) return true;
    return nodes.some((k, ki) => ki !== j && isBearing(k.rp.part) && k.box.intersectsBox(nodes[j].box.clone().expandByScalar(1)) && boreOn(ki, c, d));
  };
  nodes.forEach((n, i) => {
    if (hw[i]) return;
    for (const s of n.snaps) {
      const [x, y, z] = [Math.round(s.pos.x), Math.round(s.pos.y), Math.round(s.pos.z)];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const t of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
              if (t.i <= i || t.s.pos.distanceTo(s.pos) > 0.6 || t.s.normal.dot(s.normal) > -0.98) continue;
              const shaftish = (isShaft(n.rp.part) && !s.snap.male) || (isShaft(nodes[t.i].rp.part) && !t.s.snap.male);
              if (shaftish && !BOLT.has(s.snap.type)) continue; // shafts are handled by axis below
              // a motor's male output snap touching a bore: that bore turns with the motor output, not the motor body
              const outA = s.snap.male && BORE.has(s.snap.type) && outOf.has(i);
              const outB = t.s.snap.male && BORE.has(t.s.snap.type) && outOf.has(t.i);
              // a motor shaft passing through a clearance / bearing hole doesn't join anything; a REX / D bore locks on
              if (outA && (!BORE.has(t.s.snap.type) || bearingLike(t.i))) continue;
              if (outB && (!BORE.has(s.snap.type) || bearingLike(i))) continue;
              if (outA) rigid.union(outOf.get(i)!, t.i, 'out-contact');
              else if (outB) rigid.union(outOf.get(t.i)!, i, 'out-contact');
              else {
                // a bearing joins things only by its outer flange (seated in a plate / wheel); whatever touches its
                // inner race turns in it
                if ((bearingLike(i) && !s.snap.male) || (bearingLike(t.i) && !t.s.snap.male)) continue;
                if (!screwed(s.pos) && (spinsAgainst(i, t.i) || spinsAgainst(t.i, i))) continue;
                rigid.union(i, t.i, 'contact ' + s.snap.type + '/' + t.s.snap.type);
              }
            }
    }
  });

  // ---- 2. shafts: parts with a REX / D bore on a shaft are locked to it; bearings and plain 14 mm bores let it turn
  nodes.forEach((sh, si) => {
    if (!isShaft(sh.rp.part)) return;
    const ax = shaftAxis(sh);
    const near = sh.box.clone().expandByScalar(2);
    nodes.forEach((o, oi) => {
      if (oi === si || hw[oi] || !o.box.intersectsBox(near)) return;
      let lock = false, spin = false;
      for (const s of o.snaps) {
        if (s.snap.male || Math.abs(s.normal.dot(ax.d)) < 0.995 || distToLine(s.pos, ax.o, ax.d) > 0.6) continue;
        const t = s.pos.clone().sub(ax.o).dot(ax.d);
        if (t < ax.lo - 1 || t > ax.hi + 1) continue;
        if (BORE.has(s.snap.type) && !bearingLike(oi)) lock = true;
        else if (s.snap.type === 'bearing_14mm' || bearingLike(oi)) spin = true;
      }
      if (lock) rigid.union(si, oi, 'shaft-lock');
      else if (spin) revolute.push({ a: oi, b: si, o: ax.o.clone(), d: ax.d.clone() });
    });
  });

  // ---- 3. motor outputs: bores on the output axis within the shaft's reach
  for (const ni of actuatorNodes) {
    const n = nodes[ni];
    const out = outOf.get(ni)!;
    if (isMotor(n.rp.part)) {
      const ms = n.rp.part.snapPoints.find((s) => s.male && BORE.has(s.type));
      const ws = ms && n.snaps.find((w) => w.snap.id === ms.id && !!w.snap.male);
      if (!ws) continue;
      const lb = n.rp.part.bounds ?? [[0, 0, 0], [0, 40, 0]];
      const reach = Math.max(10, lb[1][1] - (ms?.position[1] ?? 0)) + 2;
      nodes.forEach((o, oi) => {
        if (oi === ni || hw[oi] || o.box.distanceToPoint(ws.pos) > reach + 5) return;
        const on = o.snaps.some((t) => BORE.has(t.snap.type) && !t.snap.male && Math.abs(t.normal.dot(ws.normal)) > 0.995 && distToLine(t.pos, ws.pos, ws.normal) < 0.6 && (() => {
          const a = t.pos.clone().sub(ws.pos).dot(ws.normal);
          return a > -1.5 && a < reach;
        })());
        if (!on) return;
        if (!bearingLike(oi)) rigid.union(out, oi, 'motor-out');
      });
      revolute.push({ a: ni, b: out, o: ws.pos.clone(), d: ws.normal.clone() });
    } else {
      // servo: the spline part (horn / hub / spline shaft) touching it marks the output axis
      const near = n.box.clone().expandByScalar(3);
      const sp = nodes.findIndex((o, oi) => oi !== ni && isSpline(o.rp.part) && o.box.intersectsBox(near));
      if (sp < 0) continue;
      const o = nodes[sp];
      const axL = spinAxisLocal(o.rp.part);
      const d = axL.clone().applyQuaternion(o.q).normalize();
      const c = spinCentreLocal(o.rp.part, axL).applyMatrix4(o.m);
      // point the axis away from the servo body
      if (n.box.getCenter(new Vector3()).sub(c).dot(d) > 0) d.negate();
      rigid.union(out, sp);
      revolute.push({ a: ni, b: out, o: c, d });
    }
  }

  // ---- 4. tolerance: parts that touch nothing ride along with what their box overlaps most (else the heaviest body)
  const isolated = (i: number) => {
    const r = rigid.find(i);
    for (let j = 0; j < total; j++) if (j !== i && rigid.find(j) === r) return false;
    return !revolute.some((e) => e.a === i || e.b === i);
  };
  let carried = 0;
  nodes.forEach((n, i) => {
    if (hw[i] || !isolated(i)) return;
    // round parts (wheels, gears, sprockets) belong to whatever sits on their axis: a hub, a shaft, a motor output
    if (wheelInfo(n.rp.part) || toothInfo(n.rp.part)) {
      const axL = n.rp.part.category === 'Wheels' ? new Vector3(1, 0, 0) : spinAxisLocal(n.rp.part);
      const d = axL.clone().applyQuaternion(n.q).normalize();
      const c = (n.rp.part.category === 'Wheels' ? new Vector3() : spinCentreLocal(n.rp.part, axL)).applyMatrix4(n.m);
      const half = n.box.getSize(new Vector3()).length() / 2 + 10;
      let hit = -1, hd = Infinity;
      nodes.forEach((o, j) => {
        if (j === i || hw[j]) return;
        for (const s of o.snaps) {
          if (s.snap.type === 'm4_hole' || Math.abs(s.normal.dot(d)) < 0.995 || distToLine(s.pos, c, d) > 1.0) continue;
          const t = Math.abs(s.pos.clone().sub(c).dot(d));
          if (t < half && t < hd) (hd = t), (hit = j);
        }
      });
      // a motor's own output on this axis: join the output, not the motor body
      for (const ni of actuatorNodes) {
        const mn = nodes[ni];
        const ms = mn.snaps.find((w) => w.snap.male && BORE.has(w.snap.type));
        if (!ms || Math.abs(ms.normal.dot(d)) < 0.995 || distToLine(ms.pos, c, d) > 1.0) continue;
        const t = Math.abs(ms.pos.clone().sub(c).dot(d));
        if (t < half && t < hd) (hd = t), (hit = -2 - ni);
      }
      if (hit >= 0 && !isMotor(nodes[hit].rp.part)) {
        rigid.union(i, hit, 'carried-axis');
        carried++;
        return;
      }
      if (hit <= -2) {
        rigid.union(i, outOf.get(-2 - hit)!, 'carried-axis');
        carried++;
        return;
      }
    }
    let best = -1, bv = 0;
    const eb = n.box.clone().expandByScalar(1);
    nodes.forEach((o, j) => {
      if (j === i || hw[j] || !eb.intersectsBox(o.box)) return;
      const ov = eb.clone().intersect(o.box).getSize(new Vector3());
      // a loose part (a stopper, a guide) belongs to the frame near it, not to a roller or shaft spinning past it
      const spinning = roundish(j) || isShaft(o.rp.part) || isMotor(o.rp.part);
      const v = (ov.x + 0.1) * (ov.y + 0.1) * (ov.z + 0.1) * (spinning ? 0.02 : 1);
      if (v > bv) (bv = v), (best = j);
    });
    if (best >= 0) {
      rigid.union(i, best, 'carried');
      carried++;
    }
  });
  // hardware (screws / nuts) joins the body it passes through or sits on
  nodes.forEach((n, i) => {
    if (!hw[i]) return;
    const eb = n.box.clone().expandByScalar(0.5);
    let best = -1, bv = 0;
    nodes.forEach((o, j) => {
      if (j === i || hw[j] || !eb.intersectsBox(o.box)) return;
      const v = eb.clone().intersect(o.box).getSize(new Vector3()).length();
      if (v > bv) (bv = v), (best = j);
    });
    if (best >= 0) rigid.union(i, best, 'hardware');
  });

  // ---- 5. bodies
  const rootOf = new Map<number, number>(); // dsu root -> body id
  const bodies: RigBody[] = [];
  const bodyOfNode = (i: number) => rootOf.get(rigid.find(i));
  for (let i = 0; i < total; i++) {
    const r = rigid.find(i);
    if (!rootOf.has(r)) {
      rootOf.set(r, bodies.length);
      bodies.push({ id: bodies.length, parts: [], mass: 0, parent: null, round: true, wheels: [], rollers: [], label: '' });
    }
    if (i < N) {
      const b = bodies[rootOf.get(r)!];
      b.parts.push(nodes[i].rp);
      b.mass += nodes[i].rp.part.massGrams;
    }
  }
  // chassis = heaviest body that is not on the far side of a revolute joint from everything else
  let chassis = 0;
  for (const b of bodies) if (b.mass > bodies[chassis].mass) chassis = b.id;

  // ---- 6. joint tree from the chassis (BFS over revolute edges)
  const edges = revolute
    .map((e) => ({ a: bodyOfNode(e.a)!, b: bodyOfNode(e.b)!, o: e.o, d: e.d }))
    .filter((e) => e.a !== undefined && e.b !== undefined && e.a !== e.b);
  const seen = new Set<number>([chassis]);
  const queue = [chassis];
  const bfs = () => {
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      const other = e.a === cur ? e.b : e.b === cur ? e.a : -1;
      if (other < 0 || seen.has(other)) continue;
      seen.add(other);
      bodies[other].parent = cur;
      bodies[other].axis = e.d.clone().normalize();
      bodies[other].pivot = e.o.clone();
      queue.push(other);
    }
  }
  };
  bfs();
  // loose bodies that hold a joint (an unbolted motor, a bearing block): weld them on and keep walking from them
  let welded = 0;
  for (const e of edges) {
    if (seen.has(e.a) || !bodies[e.a].parts.length) continue;
    bodies[e.a].parent = chassis;
    seen.add(e.a);
    welded++;
    queue.push(e.a);
    bfs();
  }
  // bodies not reachable through joints: weld to the chassis
  for (const b of bodies) {
    if (seen.has(b.id) || !b.parts.length) continue;
    b.parent = chassis;
    welded++;
  }
  // body ids that are welded (no axis) are treated as part of their parent when simulating

  // ---- 7. couplings: gears / miter gears in mesh, chains (Chain tool, else assumed between coplanar sprockets), belts
  interface Tooth {
    body: number;
    node: number;
    info: ToothInfo;
    c: Vector3;
    d: Vector3;
  }
  const nodeIndex = new Map(nodes.map((n, i) => [n.rp.instanceId, i]));
  const teeth: Tooth[] = [];
  nodes.forEach((n, i) => {
    const info = toothInfo(n.rp.part);
    if (!info || hw[i]) return;
    const axL = spinAxisLocal(n.rp.part);
    teeth.push({ body: bodyOfNode(i)!, node: i, info, c: toothCentreLocal(n.rp.part, axL).applyMatrix4(n.m), d: axL.applyQuaternion(n.q).normalize() });
  });
  const couplings: Coupling[] = [];
  const linked = new Set<string>();
  const turns = (b: number) => !!bodies[b].axis && b !== chassis;
  // signs: speeds are measured about each body's own joint axis
  const sgn = (b: number, d: Vector3) => (bodies[b].axis ? Math.sign(bodies[b].axis!.dot(d)) || 1 : 1);
  let locked = 0;
  const couple = (A: { body: number; d: Vector3; r: number }, B: { body: number; d: Vector3; r: number }, ratioAbout: number, kind: Coupling['kind']) => {
    if (A.body === B.body) return;
    const k = `${Math.min(A.body, B.body)}-${Math.max(A.body, B.body)}`;
    if (linked.has(k)) return;
    linked.add(k);
    if (!turns(A.body) || !turns(B.body)) {
      // one side is fixed to the frame: the other can't turn either (counts as a note, never breaks the sim)
      if (turns(A.body) || turns(B.body)) locked++;
      return;
    }
    // ratioAbout: ω_B = ratioAbout · ω_A, each about its own tooth axis d
    couplings.push({ a: A.body, b: B.body, ratio: ratioAbout * sgn(A.body, A.d) * sgn(B.body, B.d), kind });
  };

  // chains drawn with the Chain tool
  const chains: Rig['chains'] = [];
  const chained = new Set<number>();
  let dangling = 0;
  for (const { resolved } of resolveChains(instances, catalog)) {
    if (!resolved) {
      dangling++;
      continue;
    }
    const na = nodeIndex.get(resolved.a.inst.instanceId), nb = nodeIndex.get(resolved.b.inst.instanceId);
    if (na === undefined || nb === undefined) continue;
    const A = { body: bodyOfNode(na)!, d: resolved.a.d, r: resolved.a.r };
    const B = { body: bodyOfNode(nb)!, d: resolved.b.d, r: resolved.b.r };
    chained.add(na).add(nb);
    chains.push({ rc: resolved, a: A.body, b: B.body });
    // a chain turns both sprockets the same way: ω_B = (r_A / r_B) ω_A about the shared axis direction
    couple(A, B, (A.r / B.r) * (Math.sign(A.d.dot(B.d)) || 1), 'chain');
  }
  if (dangling) notes.push(`${dangling} chain${dangling > 1 ? 's have' : ' has'} lost a sprocket (moved or deleted) — shown red in the CAD; draw it again with the Chain tool.`);

  let assumed = 0;
  for (let i = 0; i < teeth.length; i++)
    for (let j = i + 1; j < teeth.length; j++) {
      const A = teeth[i], B = teeth[j];
      if (A.body === B.body) continue;
      const parallel = Math.abs(A.d.dot(B.d)) > 0.995;
      const off = B.c.clone().sub(A.c);
      const axial = parallel ? off.dot(A.d) : 0;
      const dist = parallel ? off.clone().sub(A.d.clone().multiplyScalar(axial)).length() : off.length();
      const same = Math.sign(A.d.dot(B.d)) || 1;
      const kA = A.info.kind, kB = B.info.kind;
      if (kA === 'gear' && kB === 'gear' && plausibleMesh(A.info, B.info, dist, true) && parallel && Math.abs(axial) < 12) {
        // spur gears turn opposite ways
        couple({ body: A.body, d: A.d, r: A.info.r }, { body: B.body, d: B.d, r: B.info.r }, -(A.info.r / B.info.r) * same, 'gear');
      } else if (kA === 'miter' && kB === 'miter' && !parallel && Math.abs(A.d.dot(B.d)) < 0.2) {
        // miter / bevel gears: axes (nearly) intersect at the apex, teeth meet near it
        const n = A.d.clone().cross(B.d).normalize();
        const gap = Math.abs(off.dot(n));
        if (gap > 3) continue;
        // apex: closest point of the two axis lines
        const w0 = A.c.clone().sub(B.c);
        const b = A.d.dot(B.d), dd = A.d.dot(w0), e = B.d.dot(w0);
        const den = 1 - b * b;
        const tA = (b * e - dd) / den, tB = (e - b * dd) / den;
        const reach = Math.max(A.info.r, B.info.r) * 2.2 + 10;
        if (Math.abs(tA) > reach || Math.abs(tB) > reach) continue;
        // with both axes pointing from the apex out to their gear, the gears turn opposite ways about them
        const oA = A.d.clone().multiplyScalar(Math.sign(-tA) || 1), oB = B.d.clone().multiplyScalar(Math.sign(-tB) || 1);
        couple({ body: A.body, d: oA, r: A.info.r }, { body: B.body, d: oB, r: B.info.r }, -(A.info.r / B.info.r), 'miter');
      } else if (kA === kB && (kA === 'sprocket' || kA === 'pulley') && parallel && Math.abs(axial) < 5 && Math.abs(A.info.pitch - B.info.pitch) < 0.01 && dist > A.info.r + B.info.r + 4 && dist < 900) {
        // no chain drawn: assume one between the nearest coplanar pair (belts are never drawn)
        if (kA === 'sprocket' && (chained.has(A.node) || chained.has(B.node))) continue;
        const closer = teeth.some((C, ci) => ci !== i && ci !== j && C.body !== A.body && C.info.kind === kA && Math.abs(C.d.dot(A.d)) > 0.995 && Math.abs(C.c.clone().sub(A.c).dot(A.d)) < 5 && C.c.distanceTo(A.c) < dist - 1 && C.c.distanceTo(A.c) > A.info.r + C.info.r + 4);
        if (closer) continue;
        const before = couplings.length;
        couple({ body: A.body, d: A.d, r: A.info.r }, { body: B.body, d: B.d, r: B.info.r }, (A.info.r / B.info.r) * same, kA === 'sprocket' ? 'chain' : 'belt');
        if (kA === 'sprocket' && couplings.length > before) assumed++;
      }
    }
  if (assumed) notes.push(`Assumed ${assumed} chain${assumed > 1 ? 's' : ''} between sprockets in line — draw ${assumed > 1 ? 'them' : 'it'} with the Chain tool (N) to be sure.`);
  if (locked) notes.push(`${locked} gear / chain link${locked > 1 ? 's go' : ' goes'} to a part fixed on the frame, so ${locked > 1 ? 'those joints are' : 'that joint is'} held still.`);

  // ---- 8. actuators and what they drive
  const actuators: Actuator[] = actuatorNodes.map((ni, k) => {
    const n = nodes[ni];
    const out = bodyOfNode(outOf.get(ni)!)!;
    const motor = isMotor(n.rp.part);
    const has = bodies[out].parts.length > 0;
    const ms = motor ? motorSpec(n.rp.part) : null;
    const ss = motor ? null : servoSpec(n.rp.part);
    return {
      id: k,
      kind: motor ? 'motor' : 'servo',
      instanceId: n.rp.instanceId,
      name: n.rp.part.name,
      body: has ? out : null,
      role: 'idle',
      label: '',
      freeRadS: ms ? ms.freeRadS : ((ss!.degPerS * Math.PI) / 180),
      stallNm: ms ? ms.stallNm : 2.5,
      rangeDeg: ss?.rangeDeg,
      degPerS: ss?.degPerS,
    };
  });
  // propagate drive through couplings (BFS from each actuator's output body)
  for (const a of actuators) {
    if (a.body === null) continue;
    const q: [number, number][] = [[a.body, 1]];
    const vis = new Set<number>();
    while (q.length) {
      const [b, r] = q.shift()!;
      if (vis.has(b)) continue;
      vis.add(b);
      if (!bodies[b].drive) bodies[b].drive = { actuator: a.id, ratio: r };
      for (const c of couplings) {
        if (c.a === b && !vis.has(c.b)) q.push([c.b, r * c.ratio]);
        else if (c.b === b && !vis.has(c.a)) q.push([c.a, r / c.ratio]);
      }
    }
  }

  // ---- 9. ground, wheels, rollers
  // lowest point: a wheel's real bottom is centre − radius (its box grows when it's turned about the axle)
  const bottomOf = (n: Node) => {
    const wi = wheelInfo(n.rp.part);
    if (wi) {
      const axle = new Vector3(1, 0, 0).applyQuaternion(n.q);
      const c = new Vector3().applyMatrix4(n.m);
      const s = Math.sqrt(Math.max(0, 1 - axle.y * axle.y)); // rim reach in Y
      return Math.max(n.box.min.y, c.y - wi.radius * s - (wi.width / 2) * Math.abs(axle.y));
    }
    return n.box.min.y;
  };
  let groundY = Infinity;
  for (const n of nodes) groundY = Math.min(groundY, bottomOf(n));
  // a body "spins" (intake roller, transfer, flywheel) when everything on it is centred on its axis; an arm has parts
  // sticking out to one side
  const ROUND = /wheel|roller|gear|sprocket|pulley|hub|shaft|spacer|collar|bearing|coupler|clamp|spline|axle/i;
  const centredOn = (p: RigPart, o: Vector3, d: Vector3) => {
    const pb = p.part.bounds ? new Box3(v3(p.part.bounds[0]), v3(p.part.bounds[1])).applyMatrix4(instanceMatrix(p.inst)) : null;
    if (!pb) return ROUND.test(p.part.name);
    const size = pb.getSize(new Vector3());
    return distToLine(pb.getCenter(new Vector3()), o, d) < Math.max(4, 0.06 * size.length());
  };
  // user overrides: a motor the user says is an intake / arm never drives wheels
  const overrideOf = (b: RigBody) => (b.drive ? opts.roles?.[actuators[b.drive.actuator].instanceId] : undefined);
  const INTAKE_WHEEL = /gecko|compliant|intake|flex/i;
  // bottom of the frame (everything that isn't a wheel): a drive wheel reaches below it, an intake wheel that is
  // merely flush with it is an intake
  let frameBottom = Infinity;
  for (const n of nodes) if (!wheelInfo(n.rp.part) && !isHardware(n.rp.part)) frameBottom = Math.min(frameBottom, n.box.min.y);
  const floorCandidates: { b: RigBody; p: RigPart }[] = [];
  for (const b of bodies) {
    b.round = !!b.axis && b.parts.every((p) => isHardware(p.part) || centredOn(p, b.pivot!, b.axis!));
    for (const p of b.parts) {
      const wi = wheelInfo(p.part);
      if (!wi) continue;
      const centre = new Vector3().applyMatrix4(instanceMatrix(p.inst));
      const axle = new Vector3(1, 0, 0).applyQuaternion(q4(p.inst.quaternion)).normalize();
      if (Math.abs(axle.y) < 0.35 && centre.y - wi.radius < groundY + 6 && (b.axis || b.id !== chassis) && !overrideOf(b) && (!INTAKE_WHEEL.test(p.part.name) || centre.y - wi.radius < frameBottom - 1.5)) floorCandidates.push({ b, p });
    }
  }
  // soft intake wheels on a single shaft near the floor are an intake that reaches the ground, not a drivetrain
  const floorBodies = new Set(floorCandidates.map((c) => c.b.id));
  const intakeOnly = floorBodies.size === 1 && floorCandidates.every((c) => INTAKE_WHEEL.test(c.p.part.name));
  const onFloorIds = new Set(intakeOnly ? [] : floorCandidates.map((c) => c.p.instanceId));
  for (const b of bodies) {
    for (const p of b.parts) {
      const wi = wheelInfo(p.part);
      if (!wi) continue;
      const m = instanceMatrix(p.inst);
      const centre = new Vector3().applyMatrix4(m);
      const axle = new Vector3(1, 0, 0).applyQuaternion(q4(p.inst.quaternion)).normalize();
      if (onFloorIds.has(p.instanceId)) {
        const w: RigWheel = { instanceId: p.instanceId, info: wi, centre, axle };
        if (wi.mecanum) {
          // roller axis at the bottom of the wheel, in the part frame: the top roller is (1,0,h)/√2;
          // rotate it about the axle (X) to the rim point that touches the floor
          const down = new Vector3(0, -1, 0).applyQuaternion(q4(p.inst.quaternion).invert());
          // rotating +Y about X by phi lands on the rim point that touches the floor; rollers follow the same turn
          const phi = Math.atan2(down.z, down.y);
          const e = new Vector3(1, 0, wi.mecanum).normalize().applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), phi));
          const ew = e.applyQuaternion(q4(p.inst.quaternion));
          ew.y = 0;
          w.roller = ew.normalize();
        }
        b.wheels.push(w);
      } else if (b.axis) {
        b.rollers.push({ instanceId: p.instanceId, centre, axle, radius: wi.radius, width: wi.width, squish: wi.squish });
      }
    }
  }

  // ---- 10. roles + labels
  const allDriven = (aid: number) => bodies.filter((b) => b.drive?.actuator === aid && b.axis && b.id !== chassis);
  const jammed: string[] = [];
  for (const a of actuators) {
    if (a.body !== null && (!bodies[a.body].axis || a.body === chassis)) {
      // the output got joined to the motor's own mount (a part on the shaft touching the frame without a bearing)
      jammed.push(a.name.split('(')[0].trim());
      a.body = null;
    }
    const driven = allDriven(a.id);
    if (!driven.length) {
      a.role = 'idle';
      continue;
    }
    const o = opts.roles?.[a.instanceId];
    if (o) a.role = o;
    else if (driven.some((b) => b.wheels.length)) a.role = 'drive';
    else if (a.kind === 'motor' && driven.every((b) => b.round)) a.role = 'spinner';
    else a.role = 'arm';
  }
  const motors = actuators.filter((a) => a.role === 'drive');
  const driveWheels = bodies.flatMap((b) => b.wheels);
  const robotBox = new Box3();
  for (const n of nodes) robotBox.union(n.box);
  const centre = robotBox.getCenter(new Vector3());
  let nSpin = 0, nArm = 0, nIdle = 0;
  for (const a of actuators) {
    const short = a.kind === 'servo' ? 'Servo' : 'Motor';
    if (a.role === 'drive') {
      const ws = bodies.filter((b) => b.drive?.actuator === a.id).flatMap((b) => b.wheels);
      const c = ws.reduce((s, w) => s.add(w.centre), new Vector3()).multiplyScalar(1 / Math.max(1, ws.length));
      const side = c.x > centre.x + 5 ? 'right' : c.x < centre.x - 5 ? 'left' : '';
      const fb = c.z > centre.z + 5 ? 'front' : c.z < centre.z - 5 ? 'back' : '';
      a.label = `Drive ${[fb, side].filter(Boolean).join('-') || ''}`.trim();
    } else if (a.role === 'spinner') {
      // the lowest set of rollers picks up from the floor (intake); rollers higher up move elements on (transfer)
      const lowest = (id: number) => Math.min(...allDriven(id).flatMap((b) => b.rollers.map((r) => r.centre.y)));
      const rollerSpinners = actuators.filter((x) => x.role === 'spinner' && allDriven(x.id).some((b) => b.rollers.length)).sort((x, y) => lowest(x.id) - lowest(y.id));
      const k = rollerSpinners.indexOf(a);
      if (k === 0) a.label = 'Intake';
      else if (k > 0) a.label = rollerSpinners.length > 2 ? `Transfer ${k}` : 'Transfer';
      else a.label = `Spinner ${++nSpin}`;
    } else if (a.role === 'arm') a.label = `${a.kind === 'servo' ? 'Servo' : 'Arm'} ${++nArm}`;
    else a.label = `${short} ${++nIdle} (nothing attached)`;
  }
  for (const b of bodies) {
    if (b.id === chassis) b.label = 'Chassis';
    else if (b.drive) b.label = actuators[b.drive.actuator].label;
    else if (b.axis) b.label = 'Free joint';
    else b.label = 'Welded';
  }

  // ---- 11. drivetrain kind
  let kind: Rig['drive']['kind'] = 'none';
  if (driveWheels.length) {
    if (driveWheels.every((w) => w.info.mecanum)) kind = 'mecanum';
    else if (driveWheels.every((w) => w.info.omni)) {
      const axles = driveWheels.map((w) => w.axle);
      kind = axles.some((a) => Math.abs(a.x) > 0.3 && Math.abs(a.z) > 0.3) ? 'x-drive' : 'omni';
    } else kind = 'tank';
  }

  // ---- 12. mass + notes
  let mass = 0;
  const cog = new Vector3();
  for (const n of nodes) {
    const w = n.rp.part.massGrams;
    mass += w;
    cog.add(n.box.getCenter(new Vector3()).multiplyScalar(w));
  }
  cog.multiplyScalar(1 / Math.max(1, mass));
  if (!driveWheels.length) notes.push('No powered wheels touch the floor — the robot can’t drive yet. Wheels need a motor (directly or through gears/chain) and to be the lowest point.');
  if (carried) notes.push(`${carried} part${carried > 1 ? 's' : ''} not joined by holes ride along with what they touch.`);
  if (welded) notes.push(`${welded} loose assembl${welded > 1 ? 'ies are' : 'y is'} held to the chassis.`);
  if (nodes.some((n) => isSlide(n.rp.part))) notes.push('Linear slides are held at their current extension in this beta.');
  const freeJoints = bodies.filter((b) => b.axis && !b.drive && b.id !== chassis).length;
  if (freeJoints) notes.push(`${freeJoints} joint${freeJoints > 1 ? 's turn' : ' turns'} freely with no motor — held still.`);
  for (const j of jammed) notes.push(`${j}: what’s on its shaft is joined to the frame it’s mounted on, so it can’t turn. Is a part on the shaft screwed to, or touching, a plate without a bearing?`);
  for (const a of actuators) if (a.role === 'idle' && !jammed.includes(a.name.split('(')[0].trim())) notes.push(`${a.name.split('(')[0].trim()}: nothing is mounted on its output.`);
  if (motors.length && kind === 'mecanum') {
    const hands = driveWheels.map((w) => w.info.mecanum);
    if (Math.abs(hands.reduce<number>((s, h) => s + h, 0)) === hands.length) notes.push('All mecanum wheels are the same hand — use 2 Left + 2 Right (rollers form an X seen from above) or it can’t strafe.');
    else {
      // turning authority: each wheel's speed per unit yaw rate, vs. what a correct X layout gives
      let got = 0, ideal = 0;
      for (const w of driveWheels) {
        if (!w.roller) continue;
        const r = w.centre.clone().sub(cog).setY(0);
        const f = w.axle.clone().cross(new Vector3(0, -1, 0)).normalize();
        const fe = Math.abs(f.dot(w.roller));
        if (fe < 0.2) continue;
        got += Math.abs(r.clone().cross(w.roller).y) / fe;
        ideal += Math.abs(r.x) + Math.abs(r.z);
      }
      if (ideal > 0 && got < 0.6 * ideal) notes.push('Mecanum wheels look swapped: put Left wheels front-left + back-right and Right wheels front-right + back-left (rollers form an X seen from above), or the robot turns poorly.');
    }
  }
  // tidy: drop empty virtual bodies from the list order but keep ids stable
  return { bodies, actuators, couplings, groundY, mass, cog, drive: { kind, wheels: driveWheels.length, motors: motors.length }, chains, notes };
}

export const rigChassis = (rig: Rig) => rig.bodies.find((b) => b.label === 'Chassis')!;
