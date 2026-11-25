// Collision (interference) detection on the real part meshes.
//
// Every part gets a BVH and an even sampling of its surface (local frame, cached per mesh).
// A pair of parts collides where a surface sample of one lies INSIDE the other's material by
// more than `tolMm`: coincident faces (flush joints), facet noise and thread engagement stay
// below the tolerance. Intended overlaps around a shared hole axis (screw in a hole, shaft in a
// bore, bearing in a seat) are excluded inside a radius that depends on the snap types.
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3, Box3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CatalogPart, PlacedInstance, SnapType } from '../../types/cad';
import { instanceMatrix, worldSnaps, distToLine, type WorldSnap } from '../snap';

export interface MeshSource {
  /** Triangle soup in the part frame, xyz per vertex, 3 vertices per triangle. */
  triangles: Float32Array;
}

export interface Collider {
  bvh: MeshBVH;
  index: ArrayLike<number>;
  pos: ArrayLike<number>;
  samples: Float32Array;
  bounds: Box3;
}

export interface Collision {
  a: string;
  b: string;
  skuA: string;
  skuB: string;
  /** Deepest penetration found (mm). */
  depth: number;
  /** World-space centre of the penetrating samples. */
  point: [number, number, number];
  /** Number of penetrating surface samples (a rough size of the overlap). */
  samples: number;
}

/** Radius (mm) around a shared snap axis inside which overlap is intended. */
export const AXIS_CLEAR: Record<SnapType, number> = {
  m4_hole: 2.7,
  hub_pattern_16mm: 2.7,
  d_6mm: 3.8,
  rex_8mm: 5.4,
  bearing_14mm: 7.8,
};

const colliders = new WeakMap<Float32Array, Collider>();

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildCollider(tri: Float32Array): Collider {
  const hit = colliders.get(tri);
  if (hit) return hit;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(tri, 3));
  const bvh = new MeshBVH(g);
  g.computeBoundingBox();
  // surface samples: ~1 per s² mm², s adaptive so big plates stay cheap
  const nt = tri.length / 9;
  let area = 0;
  const areas = new Float32Array(nt);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < nt; t++) {
    a.fromArray(tri, t * 9);
    b.fromArray(tri, t * 9 + 3);
    c.fromArray(tri, t * 9 + 6);
    const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    areas[t] = ar;
    area += ar;
  }
  const s = Math.min(3, Math.max(1, Math.sqrt(area / 40000)));
  const rnd = seeded(nt * 7919 + 13);
  const out: number[] = [];
  let carry = rnd();
  for (let t = 0; t < nt; t++) {
    carry += areas[t] / (s * s);
    while (carry >= 1) {
      carry -= 1;
      let u = rnd(), v = rnd();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;
      for (let k = 0; k < 3; k++) out.push(tri[t * 9 + k] * w + tri[t * 9 + 3 + k] * u + tri[t * 9 + 6 + k] * v);
    }
  }
  const col: Collider = { bvh, index: g.index!.array, pos: tri, samples: new Float32Array(out), bounds: g.boundingBox!.clone() };
  colliders.set(tri, col);
  return col;
}

const RAY_DIRS = [new Vector3(0.5774, 0.5774, 0.5774), new Vector3(-0.267, 0.534, -0.802), new Vector3(0.802, -0.267, -0.534)].map((d) => d.normalize());
const tmpRay = new Ray();

/** Point (collider frame) strictly inside the closed mesh: majority vote of 3 ray parities. */
function insideByRays(col: Collider, p: Vector3) {
  let votes = 0;
  for (const d of RAY_DIRS) {
    tmpRay.origin.copy(p);
    tmpRay.direction.copy(d);
    const hits = col.bvh.raycast(tmpRay, DoubleSide).map((h) => h.distance).sort((x, y) => x - y);
    let n = 0;
    let last = -1;
    for (const h of hits) {
      if (h - last > 1e-3) n++;
      last = h;
    }
    if (n % 2 === 1) votes++;
  }
  return votes >= 2;
}

const tv = new Vector3(), ta = new Vector3(), tb = new Vector3(), tc = new Vector3(), tn = new Vector3();
const target = { point: new Vector3(), distance: 0, faceIndex: 0 };

/** Penetration depth of point p (collider frame), or 0 when outside / within tol of the surface. */
export function penetration(col: Collider, p: Vector3, tol: number): number {
  const r = col.bvh.closestPointToPoint(p, target as never);
  if (!r || r.distance <= tol) return 0;
  const f = r.faceIndex;
  const ix = col.index;
  ta.fromArray(col.pos as Float32Array, ix[f * 3] * 3);
  tb.fromArray(col.pos as Float32Array, ix[f * 3 + 1] * 3);
  tc.fromArray(col.pos as Float32Array, ix[f * 3 + 2] * 3);
  tn.subVectors(tb, ta).cross(tv.subVectors(tc, ta));
  tv.subVectors(p, r.point);
  if (tv.dot(tn) > 0) return 0; // on the outside of the nearest face
  return insideByRays(col, p) ? r.distance : 0;
}

interface Axis {
  o: Vector3;
  d: Vector3;
  r: number;
}

/** Hole/shaft axes shared by both parts (snaps coaxial within 0.3 mm). */
export function sharedAxes(sa: WorldSnap[], sb: WorldSnap[]): Axis[] {
  const out: Axis[] = [];
  for (const a of sa)
    for (const b of sb) {
      if (Math.abs(a.normal.dot(b.normal)) < 0.9995) continue;
      if (distToLine(b.pos, a.pos, a.normal) > 0.3) continue;
      const r = Math.max(AXIS_CLEAR[a.snap.type], AXIS_CLEAR[b.snap.type]);
      if (!out.some((x) => Math.abs(x.d.dot(a.normal)) > 0.9995 && distToLine(a.pos, x.o, x.d) < 0.3 && x.r >= r)) out.push({ o: a.pos, d: a.normal, r });
    }
  return out;
}

function worldBox(inst: PlacedInstance, col: Collider) {
  return col.bounds.clone().applyMatrix4(instanceMatrix(inst));
}

/** One direction: samples of A inside B. Returns deepest point stats (world). */
function probe(A: PlacedInstance, ca: Collider, B: PlacedInstance, cb: Collider, overlap: Box3, axes: Axis[], tol: number) {
  const mA = instanceMatrix(A);
  const toB = instanceMatrix(B).invert().multiply(mA);
  const p = new Vector3(), w = new Vector3();
  const box = cb.bounds.clone().expandByScalar(-tol);
  let depth = 0, n = 0;
  const sum = new Vector3();
  const S = ca.samples;
  for (let i = 0; i < S.length; i += 3) {
    w.set(S[i], S[i + 1], S[i + 2]).applyMatrix4(mA);
    if (!overlap.containsPoint(w)) continue;
    p.set(S[i], S[i + 1], S[i + 2]).applyMatrix4(toB);
    if (!box.containsPoint(p)) continue;
    let skip = false;
    for (const ax of axes)
      if (distToLine(w, ax.o, ax.d) < ax.r) {
        skip = true;
        break;
      }
    if (skip) continue;
    const d = penetration(cb, p, tol);
    if (d > 0) {
      n++;
      sum.add(w);
      if (d > depth) depth = d;
    }
  }
  return { depth, n, sum };
}

const pairCache = new Map<string, Collision | null>();
const poseKey = (i: PlacedInstance) => `${i.sku}@${i.position.map((x) => x.toFixed(3)).join(',')}/${i.quaternion.map((x) => x.toFixed(5)).join(',')}`;

export function clearCollisionCache() {
  pairCache.clear();
}

/** Check one pair (cached on both poses). */
export function checkPair(A: PlacedInstance, pa: CatalogPart, ca: Collider, B: PlacedInstance, pb: CatalogPart, cb: Collider, tol = 0.4): Collision | null {
  const key = `${poseKey(A)}|${poseKey(B)}|${pa.snapPoints.length},${pb.snapPoints.length}|${ca.samples.length},${cb.samples.length}|${tol}`;
  if (pairCache.has(key)) {
    const c = pairCache.get(key)!;
    return c && { ...c, a: A.instanceId, b: B.instanceId };
  }
  const ba = worldBox(A, ca), bb = worldBox(B, cb);
  const overlap = ba.clone().intersect(bb);
  let res: Collision | null = null;
  if (!overlap.isEmpty() && Math.min(...overlap.getSize(new Vector3()).toArray()) > tol) {
    overlap.expandByScalar(0.01);
    const axes = sharedAxes(worldSnaps(A, pa), worldSnaps(B, pb));
    const r1 = probe(A, ca, B, cb, overlap, axes, tol);
    const r2 = probe(B, cb, A, ca, overlap, axes, tol);
    const n = r1.n + r2.n;
    // a couple of stray samples at sharp edges are noise; need either several or a deep one
    if (n >= 3 || Math.max(r1.depth, r2.depth) > 1.2) {
      const c = r1.sum.add(r2.sum).multiplyScalar(1 / n);
      res = { a: A.instanceId, b: B.instanceId, skuA: A.sku, skuB: B.sku, depth: Math.max(r1.depth, r2.depth), point: [c.x, c.y, c.z], samples: n };
    }
  }
  if (pairCache.size > 20000) pairCache.clear();
  pairCache.set(key, res);
  return res;
}

export interface CollisionRun {
  collisions: Collision[];
  pairsChecked: number;
  ms: number;
}

/**
 * All pairwise collisions between visible parts. `meshOf` gives each SKU's triangle soup.
 * Async: yields to the UI between pairs so big robots stay responsive.
 */
export async function findCollisions(
  instances: PlacedInstance[],
  catalog: Record<string, CatalogPart>,
  meshOf: (part: CatalogPart) => MeshSource | null,
  opts: { tol?: number; only?: Set<string>; onProgress?: (done: number, total: number) => void; yieldEvery?: number } = {},
): Promise<CollisionRun> {
  const t0 = performance.now();
  const tol = opts.tol ?? 0.4;
  const list: { inst: PlacedInstance; part: CatalogPart; col: Collider; box: Box3 }[] = [];
  for (const inst of instances) {
    if (inst.hidden) continue;
    const part = catalog[inst.sku];
    if (!part) continue;
    const m = meshOf(part);
    if (!m || !m.triangles.length) continue;
    const col = buildCollider(m.triangles);
    list.push({ inst, part, col, box: worldBox(inst, col) });
  }
  // broad phase: sort-and-sweep on x
  const order = [...list].sort((x, y) => x.box.min.x - y.box.min.x);
  const pairs: [number, number][] = [];
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) {
      if (order[j].box.min.x > order[i].box.max.x - tol) break;
      if (!order[i].box.intersectsBox(order[j].box)) continue;
      if (opts.only && !opts.only.has(order[i].inst.instanceId) && !opts.only.has(order[j].inst.instanceId)) continue;
      pairs.push([i, j]);
    }
  const collisions: Collision[] = [];
  let last = performance.now();
  for (let k = 0; k < pairs.length; k++) {
    const A = order[pairs[k][0]], B = order[pairs[k][1]];
    const c = checkPair(A.inst, A.part, A.col, B.inst, B.part, B.col, tol);
    if (c) collisions.push(c);
    if (performance.now() - last > (opts.yieldEvery ?? 24)) {
      opts.onProgress?.(k + 1, pairs.length);
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
  }
  opts.onProgress?.(pairs.length, pairs.length);
  collisions.sort((x, y) => y.depth * y.samples - x.depth * x.samples);
  return { collisions, pairsChecked: pairs.length, ms: performance.now() - t0 };
}
