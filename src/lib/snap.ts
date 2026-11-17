// Snap math: world-space snap points and the hole-to-hole mating transform.
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, Quat, SnapPoint, SnapType, Vec3 } from '../types/cad';

export interface WorldSnap {
  instanceId: string;
  sku: string;
  snap: SnapPoint;
  pos: Vector3;
  normal: Vector3;
  up: Vector3;
}

const COMPAT: Record<SnapType, SnapType[]> = {
  m4_hole: ['m4_hole', 'hub_pattern_16mm'],
  hub_pattern_16mm: ['hub_pattern_16mm', 'm4_hole'],
  bearing_14mm: ['bearing_14mm'],
  rex_8mm: ['rex_8mm'],
  d_6mm: ['d_6mm'],
};

export function compatible(a: SnapPoint, b: SnapPoint) {
  if (a.male && b.male) return false;
  return COMPAT[a.type].includes(b.type);
}

export const SNAP_COLORS: Record<SnapType, string> = {
  m4_hole: '#ff6a13',
  hub_pattern_16mm: '#ffb020',
  bearing_14mm: '#22c3ee',
  rex_8mm: '#a78bfa',
  d_6mm: '#34d399',
};

export const v3 = (a: Vec3) => new Vector3(a[0], a[1], a[2]);
export const q4 = (a: Quat) => new Quaternion(a[0], a[1], a[2], a[3]);
export const toVec3 = (v: Vector3): Vec3 => [clean(v.x), clean(v.y), clean(v.z)];
export const toQuat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w];
const clean = (x: number) => {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

export function instanceMatrix(inst: Pick<PlacedInstance, 'position' | 'quaternion'>) {
  return new Matrix4().compose(v3(inst.position), q4(inst.quaternion), new Vector3(1, 1, 1));
}

/** A vector perpendicular to n (used when a snap point has no upVector). */
export function anyPerp(n: Vector3) {
  const a = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return a.sub(n.clone().multiplyScalar(a.dot(n))).normalize();
}

export function snapUp(s: SnapPoint) {
  const n = v3(s.normal).normalize();
  if (s.upVector) {
    const u = v3(s.upVector);
    u.sub(n.clone().multiplyScalar(u.dot(n)));
    if (u.lengthSq() > 1e-6) return u.normalize();
  }
  return anyPerp(n);
}

export function worldSnaps(inst: PlacedInstance, part: CatalogPart): WorldSnap[] {
  const m = instanceMatrix(inst);
  const q = q4(inst.quaternion);
  return part.snapPoints.map((s) => ({
    instanceId: inst.instanceId,
    sku: inst.sku,
    snap: s,
    pos: v3(s.position).applyMatrix4(m),
    normal: v3(s.normal).applyQuaternion(q).normalize(),
    up: snapUp(s).applyQuaternion(q).normalize(),
  }));
}

/**
 * Transform that puts `ghost` (a snap point in the ghost part's local frame) onto
 * `target` (world): positions coincide, normals oppose, and the ghost's up vector is
 * aligned with the target's up vector rotated by `angle` about the mating axis. With
 * `angle` a multiple of 90° the two parts' hole grids stay aligned.
 */
export function mateTransform(ghost: SnapPoint, target: { pos: Vector3; normal: Vector3; up: Vector3 }, angle = 0) {
  const nA = v3(ghost.normal).normalize();
  const uA = snapUp(ghost);
  const wA = new Vector3().crossVectors(nA, uA);

  const nT = target.normal.clone().normalize().negate();
  let uB = target.up.clone();
  uB.sub(target.normal.clone().multiplyScalar(uB.dot(target.normal)));
  if (uB.lengthSq() < 1e-8) uB = anyPerp(target.normal);
  uB.normalize().applyAxisAngle(target.normal.clone().normalize(), angle);
  const wT = new Vector3().crossVectors(nT, uB);

  const BA = new Matrix4().makeBasis(nA, uA, wA);
  const BT = new Matrix4().makeBasis(nT, uB, wT);
  const R = BT.multiply(BA.transpose());
  const q = new Quaternion().setFromRotationMatrix(R).normalize();
  const p = target.pos.clone().sub(v3(ghost.position).applyQuaternion(q));
  return { position: p, quaternion: q };
}

/** Rotate an instance about a world axis through a pivot. */
export function rotateAbout(inst: PlacedInstance, axis: Vector3, pivot: Vector3, angle: number) {
  const r = new Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
  const p = v3(inst.position).sub(pivot).applyQuaternion(r).add(pivot);
  const q = r.multiply(q4(inst.quaternion)).normalize();
  return { position: toVec3(p), quaternion: toQuat(q) };
}

/** Distance from point to an infinite line. */
export function distToLine(p: Vector3, origin: Vector3, dir: Vector3) {
  const d = p.clone().sub(origin);
  return d.sub(dir.clone().multiplyScalar(d.dot(dir))).length();
}
