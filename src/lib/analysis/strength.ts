// Structure & stability check: joints and their fasteners, shaft support, parts that are not attached,
// long cantilevers, and how far the robot can tilt / accelerate before it tips over.
import { isChainSku } from '../chain';
import { Box3, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, Vec3 } from '../../types/cad';
import { instanceMatrix, q4, v3, worldSnaps, distToLine, type WorldSnap } from '../snap';
import { massProps } from '../metrics';
import type { MeshSource } from './collide';

export type Level = 'error' | 'warn' | 'info' | 'ok';

export interface Issue {
  level: Level;
  kind: 'joint' | 'screw' | 'shaft' | 'floating' | 'cantilever' | 'stability';
  title: string;
  detail: string;
  ids: string[];
  point?: Vec3;
}

export interface Joint {
  a: string;
  b: string;
  kind: 'bolted' | 'shaft' | 'seat';
  holes: number;
  screws: number;
  status: 'ok' | 'weak' | 'loose';
  point: Vec3;
}

export interface Stability {
  ok: boolean;
  /** Smallest tilt (deg) before the CoG passes a support edge. */
  tipAngleDeg: number;
  /** Matching acceleration (in g) that would tip the robot (braking / sideways). */
  tipAccelG: number;
  /** Which way it tips first: '+X', '-X', '+Z', '-Z' or a diagonal. */
  tipToward: string;
  cogHeightMm: number;
  /** Support polygon (convex hull of ground contacts) in XZ, at ground height. */
  hull: [number, number][];
  groundY: number;
  cog: Vec3 | null;
  /** CoG distance from the support polygon's centroid (mm, XZ). */
  cogOffsetMm: number;
}

export interface StrengthReport {
  joints: Joint[];
  issues: Issue[];
  stability: Stability | null;
  score: { joints: number; fastened: number; weak: number; loose: number; parts: number; attached: number };
}

// ---------------------------------------------------------------- part classes

const pre = (sku: string, list: string[]) => list.some((p) => sku.startsWith(p));
export const isScrewPart = (p: CatalogPart) => pre(p.sku, ['2800-', '2802-', '2804-', '2813-', '2822-']) || (/screw/i.test(p.name) && !/set screw|assortment/i.test(p.name) && p.category === 'Fasteners & Spacers');
export const isNutPart = (p: CatalogPart) => /lock ?nut|\bnut\b/i.test(p.name) && !/lead screw|gorail|hurricane/i.test(p.name);
const isWasherOrSet = (p: CatalogPart) => /washer|set screw|shim/i.test(p.name);
export const isFastenerPart = (p: CatalogPart) => isScrewPart(p) || isNutPart(p) || isWasherOrSet(p);
export const isShaftPart = (p: CatalogPart) => pre(p.sku, ['2100-', '2101-', '2102-', '2105-', '2106-', '2109-', '2110-', '3501-']);
const isBearingPart = (p: CatalogPart) => /^16\d\d-/.test(p.sku) || /bearing|pillow/i.test(p.name);
const isMotorPart = (p: CatalogPart) => p.category === 'Motors & Servos' && /motor|servo/i.test(p.name) && !/mount|bracket|horn|arm|gear\b/i.test(p.name);
const isBeamPart = (p: CatalogPart) => p.category === 'Structure' && /channel|rail|beam|tube|gotube|gorail/i.test(p.name);
const isLoadOnShaft = (p: CatalogPart) => p.category === 'Wheels' || /gear|sprocket|pulley|hub|wheel|arm/i.test(p.name);

const BOLT_TYPES = new Set(['m4_hole', 'hub_pattern_16mm']);
const BORE_TYPES = new Set(['rex_8mm', 'd_6mm']);

interface Body {
  inst: PlacedInstance;
  part: CatalogPart;
  snaps: WorldSnap[];
  box: Box3;
}

const fmt = (v: Vector3): Vec3 => [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10, Math.round(v.z * 10) / 10];

class DSU {
  p = new Map<string, string>();
  find(x: string): string {
    let r = this.p.get(x) ?? x;
    if (r !== x) {
      r = this.find(r);
      this.p.set(x, r);
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}

function boundsOf(part: CatalogPart) {
  if (part.bounds) return new Box3(v3(part.bounds[0]), v3(part.bounds[1]));
  const d = part.dimensions ?? [10, 10, 10];
  return new Box3(new Vector3(-d[0] / 2, -d[1] / 2, -d[2] / 2), new Vector3(d[0] / 2, d[1] / 2, d[2] / 2));
}

function worldBox(inst: PlacedInstance, part: CatalogPart) {
  return boundsOf(part).applyMatrix4(instanceMatrix(inst));
}

/** Y-axis of a part (screw / shaft axis) in world space, with its extent along that axis. */
function yAxis(inst: PlacedInstance, part: CatalogPart) {
  const b = boundsOf(part);
  return { o: v3(inst.position), d: new Vector3(0, 1, 0).applyQuaternion(q4(inst.quaternion)).normalize(), lo: b.min.y, hi: b.max.y };
}

// ---------------------------------------------------------------- main

export function analyzeStructure(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, meshOf?: (p: CatalogPart) => MeshSource | null): StrengthReport {
  const visible = instances.filter((i) => !i.hidden && catalog[i.sku] && !isChainSku(i.sku));
  const bodies: Body[] = [];
  const screws: { inst: PlacedInstance; part: CatalogPart; o: Vector3; d: Vector3; len: number }[] = [];
  const nuts: { inst: PlacedInstance; pos: Vector3 }[] = [];
  for (const inst of visible) {
    const part = catalog[inst.sku];
    if (isScrewPart(part)) {
      const ax = yAxis(inst, part);
      // screw frame: under-head plane at y = 0, shank toward -Y
      screws.push({ inst, part, o: ax.o, d: ax.d.clone().negate(), len: Math.max(1, -ax.lo) });
    } else if (isNutPart(part)) nuts.push({ inst, pos: worldBox(inst, part).getCenter(new Vector3()) });
    else if (!isWasherOrSet(part)) bodies.push({ inst, part, snaps: worldSnaps(inst, part), box: worldBox(inst, part) });
  }
  const byId = new Map(bodies.map((b) => [b.inst.instanceId, b]));
  const issues: Issue[] = [];

  // ---- face contacts between bodies (coincident snaps, opposite normals)
  const cell = (p: Vector3) => [Math.round(p.x), Math.round(p.y), Math.round(p.z)];
  const grid = new Map<string, WorldSnap[]>();
  for (const b of bodies)
    for (const s of b.snaps) {
      const k = cell(s.pos).join(',');
      const l = grid.get(k);
      if (l) l.push(s);
      else grid.set(k, [s]);
    }
  type Contact = { s: WorldSnap; t: WorldSnap };
  const contacts = new Map<string, Contact[]>();
  for (const b of bodies)
    for (const s of b.snaps) {
      const [x, y, z] = cell(s.pos);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const t of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
              if (t.instanceId <= s.instanceId) continue; // each pair once
              if (t.pos.distanceTo(s.pos) > 0.5 || t.normal.dot(s.normal) > -0.985) continue;
              const key = `${s.instanceId}|${t.instanceId}`;
              const l = contacts.get(key);
              if (l) l.push({ s, t });
              else contacts.set(key, [{ s, t }]);
            }
    }

  // ---- screws: which holes each one passes through, and whether it ends in threads or a nut
  const screwHoles: Vector3[][] = screws.map(() => []);
  const screwBodies = new Map<number, Set<string>>();
  screws.forEach((sc, k) => {
    let threaded = false;
    const hit = new Set<string>();
    for (const b of bodies) {
      if (b.box.distanceToPoint(sc.o) > sc.len + 30) continue;
      for (const s of b.snaps) {
        if (!BOLT_TYPES.has(s.snap.type) || s.snap.male) continue;
        if (Math.abs(s.normal.dot(sc.d)) < 0.999 || distToLine(s.pos, sc.o, sc.d) > 0.3) continue;
        const along = s.pos.clone().sub(sc.o).dot(sc.d);
        if (along < -0.5 || along > sc.len + 0.5) continue;
        screwHoles[k].push(s.pos);
        hit.add(b.inst.instanceId);
        if (s.snap.tapped) threaded = true;
      }
    }
    screwBodies.set(k, hit);
    const p = fmt(sc.o);
    if (!hit.size) {
      issues.push({ level: 'warn', kind: 'screw', title: 'Screw is not in a hole', detail: `${sc.part.name} does not pass through any M4 hole.`, ids: [sc.inst.instanceId], point: p });
      return;
    }
    if (!threaded) {
      const nut = nuts.some((n) => distToLine(n.pos, sc.o, sc.d) < 1 && n.pos.clone().sub(sc.o).dot(sc.d) > 0 && n.pos.clone().sub(sc.o).dot(sc.d) < sc.len + 6);
      if (!nut)
        issues.push({
          level: 'warn',
          kind: 'screw',
          title: 'Screw has no nut',
          detail: `${sc.part.name} goes through clearance holes only — add a lock nut (Smart Fasten does this) or use a threaded hole.`,
          ids: [sc.inst.instanceId],
          point: p,
        });
    }
  });

  // ---- joints
  const joints: Joint[] = [];
  const rigid = new DSU();
  const loose = new DSU();
  for (const [key, list] of contacts) {
    const [a, b] = key.split('|');
    const bolt = list.filter((c) => BOLT_TYPES.has(c.s.snap.type) && BOLT_TYPES.has(c.t.snap.type) && !c.s.snap.male && !c.t.snap.male);
    const other = list.filter((c) => !bolt.includes(c) && (c.s.snap.male || c.t.snap.male));
    const pt = list[0].s.pos;
    if (other.length) {
      // bearing seated in a bore, shaft end in a hub, motor shaft in a bore: a real connection
      const seat = other.some((c) => c.s.snap.type === 'bearing_14mm' || c.t.snap.type === 'bearing_14mm');
      joints.push({ a, b, kind: seat ? 'seat' : 'shaft', holes: other.length, screws: 0, status: 'ok', point: fmt(pt) });
      rigid.union(a, b);
      loose.union(a, b);
      if (!bolt.length) continue;
    }
    if (!bolt.length) continue;
    // unique hole positions in this joint, and the screws through them
    const holes: Vector3[] = [];
    for (const c of bolt) if (!holes.some((h) => h.distanceTo(c.s.pos) < 0.5)) holes.push(c.s.pos);
    let nScrew = 0;
    screws.forEach((sc, k) => {
      const hb = screwBodies.get(k)!;
      if (!hb.has(a) || !hb.has(b)) return;
      if (holes.some((h) => distToLine(h, sc.o, sc.d) < 0.3)) nScrew++;
    });
    // a joint on a single hole axis (spacer, standoff) is complete with one screw
    const axes: Vector3[] = [];
    const n0 = bolt[0].s.normal;
    for (const h of holes) if (!axes.some((x) => distToLine(h, x, n0) < 0.5)) axes.push(h);
    const status: Joint['status'] = nScrew === 0 ? 'loose' : nScrew === 1 && axes.length > 1 ? 'weak' : 'ok';
    const c = holes.reduce((s, h) => s.add(h), new Vector3()).multiplyScalar(1 / holes.length);
    joints.push({ a, b, kind: 'bolted', holes: axes.length, screws: nScrew, status, point: fmt(c) });
    loose.union(a, b);
    if (nScrew > 0) rigid.union(a, b);
    const na = byId.get(a)!.part.name, nb = byId.get(b)!.part.name;
    if (status === 'loose')
      issues.push({
        level: 'error',
        kind: 'joint',
        title: 'Joint has no screws',
        detail: `${na} ↔ ${nb}: ${axes.length} aligned hole${axes.length > 1 ? 's' : ''}, nothing holding them. Select both and press J (Fasten Joint).`,
        ids: [a, b],
        point: fmt(c),
      });
    else if (status === 'weak')
      issues.push({
        level: 'warn',
        kind: 'joint',
        title: 'Joint pivots on one screw',
        detail: `${na} ↔ ${nb}: a single screw lets the joint rotate. Add a second screw (${axes.length} holes line up).`,
        ids: [a, b],
        point: fmt(c),
      });
  }

  // ---- shafts: bores on the shaft axis, bearings that support it
  for (const sh of bodies.filter((b) => isShaftPart(b.part))) {
    const ax = yAxis(sh.inst, sh.part);
    const mounted: Body[] = [];
    for (const b of bodies) {
      if (b === sh || !b.box.intersectsBox(sh.box.clone().expandByScalar(1))) continue;
      const on = b.snaps.some((s) => BORE_TYPES.has(s.snap.type) && !s.snap.male && Math.abs(s.normal.dot(ax.d)) > 0.999 && distToLine(s.pos, ax.o, ax.d) < 0.3 && (() => {
        const t = s.pos.clone().sub(ax.o).dot(ax.d);
        return t > ax.lo - 1 && t < ax.hi + 1;
      })());
      if (on) mounted.push(b);
    }
    for (const m of mounted) {
      rigid.union(sh.inst.instanceId, m.inst.instanceId);
      loose.union(sh.inst.instanceId, m.inst.instanceId);
      if (!joints.some((j) => (j.a === sh.inst.instanceId && j.b === m.inst.instanceId) || (j.b === sh.inst.instanceId && j.a === m.inst.instanceId)))
        joints.push({ a: sh.inst.instanceId, b: m.inst.instanceId, kind: 'shaft', holes: 1, screws: 0, status: 'ok', point: fmt(m.box.getCenter(new Vector3())) });
    }
    const supports = mounted.filter((m) => isBearingPart(m.part) || isMotorPart(m.part) || /coupler/i.test(m.part.name));
    const loads = mounted.filter((m) => !supports.includes(m) && isLoadOnShaft(m.part));
    const len = ax.hi - ax.lo;
    const p = fmt(sh.box.getCenter(new Vector3()));
    if (!supports.length && mounted.length)
      issues.push({ level: 'warn', kind: 'shaft', title: 'Shaft has no bearing', detail: `${sh.part.name}: nothing on it is a bearing or motor — it will wobble and bind. Add flanged bearings where it passes through structure.`, ids: [sh.inst.instanceId], point: p });
    else if (supports.length === 1 && loads.length && len > 60)
      issues.push({
        level: 'warn',
        kind: 'shaft',
        title: 'Shaft supported by one bearing',
        detail: `${sh.part.name} carries ${loads.map((l) => l.part.name).join(', ')} on a single bearing (cantilever). A second bearing on the far side makes it much stiffer.`,
        ids: [sh.inst.instanceId],
        point: p,
      });
  }

  // ---- motor / servo output shafts and other male bore features: bores further up the same axis connect
  for (const b of bodies) {
    if (isShaftPart(b.part)) continue;
    const lb = boundsOf(b.part);
    for (const s of b.part.snapPoints) {
      if (!s.male || !BORE_TYPES.has(s.type)) continue;
      const ln = v3(s.normal).normalize();
      let ext = 0;
      for (const x of [lb.min.x, lb.max.x]) for (const y of [lb.min.y, lb.max.y]) for (const z of [lb.min.z, lb.max.z]) ext = Math.max(ext, new Vector3(x, y, z).sub(v3(s.position)).dot(ln));
      const ws = b.snaps.find((w) => w.snap === s)!;
      for (const o of bodies) {
        if (o === b || o.box.distanceToPoint(ws.pos) > ext + 5) continue;
        const on = o.snaps.some((t) => BORE_TYPES.has(t.snap.type) && !t.snap.male && Math.abs(t.normal.dot(ws.normal)) > 0.999 && distToLine(t.pos, ws.pos, ws.normal) < 0.3 && (() => {
          const a = t.pos.clone().sub(ws.pos).dot(ws.normal);
          return a > -1 && a < ext + 1;
        })());
        if (!on) continue;
        rigid.union(b.inst.instanceId, o.inst.instanceId);
        loose.union(b.inst.instanceId, o.inst.instanceId);
        if (!joints.some((j) => (j.a === b.inst.instanceId && j.b === o.inst.instanceId) || (j.b === b.inst.instanceId && j.a === o.inst.instanceId)))
          joints.push({ a: b.inst.instanceId, b: o.inst.instanceId, kind: 'shaft', holes: 1, screws: 0, status: 'ok', point: fmt(o.box.getCenter(new Vector3())) });
      }
    }
  }

  // ---- attachment: islands of rigidly connected parts
  const main = (dsu: DSU) => {
    const size = new Map<string, number>();
    for (const b of bodies) size.set(dsu.find(b.inst.instanceId), (size.get(dsu.find(b.inst.instanceId)) ?? 0) + b.part.massGrams + 1);
    let best = '', bs = -1;
    for (const [k, v] of size) if (v > bs) (best = k), (bs = v);
    return best;
  };
  const mainRigid = main(rigid);
  const mainLoose = loose.find([...byId.keys()].find((id) => rigid.find(id) === mainRigid) ?? '');
  const groups = new Map<string, Body[]>();
  for (const b of bodies) {
    const r = rigid.find(b.inst.instanceId);
    if (r === mainRigid) continue;
    const l = groups.get(r);
    if (l) l.push(b);
    else groups.set(r, [b]);
  }
  const mainBoxes = bodies.filter((b) => rigid.find(b.inst.instanceId) === mainRigid).map((b) => b.box.clone().expandByScalar(2));
  for (const g of groups.values()) {
    const touching = loose.find(g[0].inst.instanceId) === mainLoose;
    const names = [...new Set(g.map((b) => b.part.name))];
    // parts with no screw holes / bores (batteries, custom 3D-printed parts, wires...) can't be checked by holes:
    // if they sit on or inside the robot, assume they are zip-tied / taped / glued on
    const noHoles = g.every((b) => !b.part.snapPoints.some((sp) => !sp.male && (BOLT_TYPES.has(sp.type) || BORE_TYPES.has(sp.type) || sp.type === 'bearing_14mm')));
    const onRobot = g.some((b) => mainBoxes.some((m) => m.intersectsBox(b.box)));
    if (noHoles && onRobot) {
      issues.push({
        level: 'info',
        kind: 'floating',
        title: 'Mounted without holes',
        detail: `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''} ha${g.length > 1 ? 've' : 's'} no screw holes to check — make sure it is zip-tied, taped or clamped.`,
        ids: g.map((b) => b.inst.instanceId),
        point: fmt(g[0].box.getCenter(new Vector3())),
      });
      continue;
    }
    issues.push({
      level: touching ? 'warn' : 'error',
      kind: 'floating',
      title: touching ? 'Sitting on the robot, not fastened' : 'Not attached to the robot',
      detail: `${g.length} part${g.length > 1 ? 's' : ''} (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}) ${touching ? 'line up with the robot but no screw holds them' : 'do not share any fastened hole, shaft or bearing with the main robot'}.`,
      ids: g.map((b) => b.inst.instanceId),
      point: fmt(g[0].box.getCenter(new Vector3())),
    });
  }

  // ---- long cantilevered beams
  for (const b of bodies.filter((x) => isBeamPart(x.part))) {
    const bb = boundsOf(b.part);
    const L = bb.max.x - bb.min.x;
    if (L < 200) continue;
    const inv = instanceMatrix(b.inst).invert();
    const xs: number[] = [];
    for (const j of joints) {
      if (j.status === 'loose' || (j.a !== b.inst.instanceId && j.b !== b.inst.instanceId)) continue;
      xs.push(v3(j.point).applyMatrix4(inv).x);
    }
    if (!xs.length) continue;
    const over = Math.max(bb.max.x - Math.max(...xs), Math.min(...xs) - bb.min.x);
    if (over > 0.6 * L && over > 150)
      issues.push({
        level: 'info',
        kind: 'cantilever',
        title: 'Long cantilever',
        detail: `${b.part.name}: ${Math.round(over)} mm sticks out past its last fastened joint. Fine for a light arm; brace it if it carries a mechanism.`,
        ids: [b.inst.instanceId],
        point: fmt(b.box.getCenter(new Vector3())),
      });
  }

  const stability = meshOf ? analyzeStability(visible, catalog, meshOf) : null;
  if (stability) {
    const hasWheels = visible.some((i) => catalog[i.sku].category === 'Wheels');
    if (!stability.ok)
      issues.push(
        hasWheels
          ? { level: 'error', kind: 'stability', title: 'Robot falls over', detail: 'The centre of gravity is outside the wheels / ground contacts — it cannot stand on its own.', ids: [], point: stability.cog ?? undefined }
          : { level: 'info', kind: 'stability', title: 'No wheels yet', detail: 'Stability is measured on the wheels; this build would not stand on its own as placed.', ids: [], point: stability.cog ?? undefined },
      );
    else if (stability.tipAngleDeg < 12)
      issues.push({ level: 'error', kind: 'stability', title: 'Tips over very easily', detail: `Tips toward ${stability.tipToward} at ${stability.tipAngleDeg.toFixed(0)}° (or ${stability.tipAccelG.toFixed(2)} g braking). Lower heavy parts or widen the wheelbase.`, ids: [], point: stability.cog ?? undefined });
    else if (stability.tipAngleDeg < 25)
      issues.push({ level: 'warn', kind: 'stability', title: 'Top-heavy', detail: `Tips toward ${stability.tipToward} at ${stability.tipAngleDeg.toFixed(0)}° tilt or ${stability.tipAccelG.toFixed(2)} g of hard braking/turning.`, ids: [], point: stability.cog ?? undefined });
  }

  const bolted = joints.filter((j) => j.kind === 'bolted');
  const attached = bodies.filter((b) => rigid.find(b.inst.instanceId) === mainRigid).length;
  const order: Record<Level, number> = { error: 0, warn: 1, info: 2, ok: 3 };
  issues.sort((x, y) => order[x.level] - order[y.level]);
  return {
    joints,
    issues,
    stability,
    score: { joints: bolted.length, fastened: bolted.filter((j) => j.status === 'ok').length, weak: bolted.filter((j) => j.status === 'weak').length, loose: bolted.filter((j) => j.status === 'loose').length, parts: bodies.length, attached },
  };
}

// ---------------------------------------------------------------- tipping

function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of [...p].reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

export function analyzeStability(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, meshOf: (p: CatalogPart) => MeshSource | null): Stability | null {
  const m = massProps(instances, catalog);
  if (!m.cog || !instances.length) return null;
  // ground = lowest mesh vertex (a rotated part's bounding box reaches below its real geometry)
  const v = new Vector3();
  const low: { i: PlacedInstance; ys: number[]; xz: [number, number][] }[] = [];
  let ground = Infinity;
  for (const i of instances) {
    const part = catalog[i.sku];
    const b = worldBox(i, part);
    const mesh = meshOf(part);
    const mat = instanceMatrix(i);
    const ys: number[] = [], xz: [number, number][] = [];
    if (mesh && mesh.triangles.length) {
      const T = mesh.triangles;
      const stride = Math.max(1, Math.floor(T.length / 3 / 20000)) * 3;
      for (let k = 0; k < T.length; k += stride) {
        v.set(T[k], T[k + 1], T[k + 2]).applyMatrix4(mat);
        ys.push(v.y);
        xz.push([v.x, v.z]);
      }
    } else
      for (const [x, y, z] of [[b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.max.z], [b.min.x, b.min.y, b.max.z]]) {
        ys.push(y);
        xz.push([x, z]);
      }
    for (const y of ys) if (y < ground) ground = y;
    low.push({ i, ys, xz });
  }
  // ground contacts: anything within 1 mm of the lowest point; wheels within 3 mm (mecanum rollers / tread
  // phase make identical wheels differ by a millimetre or two). Widen once if that leaves no real footprint.
  const contacts = (tol: number) => {
    const pts: [number, number][] = [];
    for (const l of low) {
      const wheel = catalog[l.i.sku].category === 'Wheels';
      for (let k = 0; k < l.ys.length; k++) if (l.ys[k] < ground + (wheel ? Math.max(3, tol) : tol)) pts.push(l.xz[k]);
    }
    return hull2(pts);
  };
  const area = (h: [number, number][]) => Math.abs(h.reduce((s, p, k) => s + p[0] * h[(k + 1) % h.length][1] - h[(k + 1) % h.length][0] * p[1], 0)) / 2;
  let hull = contacts(1.0);
  if (hull.length < 3 || area(hull) < 400) hull = contacts(4.0);
  const cog: Vec3 = [m.cog.x, m.cog.y, m.cog.z];
  const h = Math.max(1, m.cog.y - ground);
  const base = { hull, groundY: ground, cog, cogHeightMm: h };
  if (hull.length < 3) return { ...base, ok: false, tipAngleDeg: 0, tipAccelG: 0, tipToward: '—', cogOffsetMm: 0 };
  // signed distance from CoG to each edge (hull is CCW in (x,z))
  let best = Infinity, dir: [number, number] = [0, 0];
  let inside = true;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k], b = hull[(k + 1) % hull.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    // left normal of a CCW edge points inside
    const nx = -ez / len, nz = ex / len;
    const d = (m.cog.x - a[0]) * nx + (m.cog.z - a[1]) * nz;
    if (d < 0) inside = false;
    if (d < best) (best = d), (dir = [-nx, -nz]);
  }
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length, cz = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  const toward = (() => {
    const [x, z] = dir;
    const sx = Math.abs(x) > 0.38 ? (x > 0 ? '+X' : '−X') : '';
    const sz = Math.abs(z) > 0.38 ? (z > 0 ? '+Z' : '−Z') : '';
    return [sz, sx].filter(Boolean).join(' / ') || '+X';
  })();
  const d = Math.max(0, best);
  return { ...base, ok: inside, tipAngleDeg: (Math.atan2(d, h) * 180) / Math.PI, tipAccelG: d / h, tipToward: toward, cogOffsetMm: Math.hypot(m.cog.x - cx, m.cog.z - cz) };
}
