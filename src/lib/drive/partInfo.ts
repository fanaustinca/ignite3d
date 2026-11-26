// What a part does mechanically, read from its catalogue name + snaps: gears/sprockets/pulleys (pitch radius),
// wheels (radius, mecanum hand, omni), motors (free speed, stall torque), servos, bearings.
import { Vector3 } from 'three';
import type { CatalogPart } from '../../types/cad';
import { v3 } from '../snap';

export type ToothKind = 'gear' | 'sprocket' | 'pulley' | 'miter' | 'rack';
export interface ToothInfo {
  kind: ToothKind;
  teeth: number;
  /** Pitch radius (mm). */
  r: number;
  /** Chain / belt pitch (mm) or gear module. */
  pitch: number;
}

const num = (re: RegExp, s: string) => {
  const m = re.exec(s);
  return m ? Number(m[1]) : NaN;
};

export function toothInfo(p: CatalogPart): ToothInfo | null {
  const n = p.name;
  if (/motor|servo\b(?! gear)|bracket|turret|idler pulley|track sprocket|chain|belt(?! pulley)/i.test(n) && !/servo gear/i.test(n)) return null;
  const teeth = num(/(\d+)\s*(?:Tooth|T\b)/i, n.replace(/\d+\s*Tooth Spline/i, ''));
  if (!(teeth > 3)) return null;
  if (/rack/i.test(n)) return { kind: 'rack', teeth, r: Infinity, pitch: num(/MOD\s*([\d.]+)/i, n) || 0.8 };
  if (/miter/i.test(n)) {
    const m = num(/MOD\s*([\d.]+)/i, n) || 1;
    return { kind: 'miter', teeth, r: (m * teeth) / 2, pitch: m };
  }
  if (/gear/i.test(n)) {
    const m = num(/MOD\s*([\d.]+)/i, n) || 0.8;
    return { kind: 'gear', teeth, r: (m * teeth) / 2, pitch: m };
  }
  if (/sprocket/i.test(n)) {
    const pitch = num(/([\d.]+)\s*mm Pitch/i, n) || 8;
    return { kind: 'sprocket', teeth, r: pitch / (2 * Math.sin(Math.PI / teeth)), pitch };
  }
  if (/pulley/i.test(n)) {
    const pitch = /GT2/i.test(n) ? 2 : /HTD/i.test(n) ? num(/([\d.]+)\s*mm HTD/i, n) || 5 : num(/([\d.]+)\s*mm Pitch/i, n) || 5;
    return { kind: 'pulley', teeth, r: (pitch * teeth) / (2 * Math.PI), pitch };
  }
  return null;
}

/**
 * The axis a part spins about, in its own frame: the bore at its centre (REX / D / bearing / hub pattern),
 * else the thinnest bounding-box direction. Wheels are always X.
 */
export function spinAxisLocal(p: CatalogPart): Vector3 {
  if (p.category === 'Wheels') return new Vector3(1, 0, 0);
  let best: { d: number; n: Vector3 } | null = null;
  for (const s of p.snapPoints) {
    if (s.type === 'm4_hole') continue;
    const pos = v3(s.position);
    const n = v3(s.normal).normalize();
    // radial distance of the snap from the part origin, measured across its own axis
    const radial = pos.clone().sub(n.clone().multiplyScalar(pos.dot(n))).length();
    const score = radial + (s.type === 'hub_pattern_16mm' ? 20 : 0);
    if (!best || score < best.d) best = { d: score, n: new Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)) };
  }
  if (best && best.d < 6) {
    const a = best.n;
    return a.x > a.y && a.x > a.z ? new Vector3(1, 0, 0) : a.y > a.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  }
  const d = p.bounds ? [p.bounds[1][0] - p.bounds[0][0], p.bounds[1][1] - p.bounds[0][1], p.bounds[1][2] - p.bounds[0][2]] : p.dimensions ?? [1, 1, 1];
  const k = d[0] <= d[1] && d[0] <= d[2] ? 0 : d[1] <= d[2] ? 1 : 2;
  return new Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
}

/** Centre of the spin axis in the part frame (bounds centre projected across the axis). */
export function spinCentreLocal(p: CatalogPart, axis: Vector3): Vector3 {
  const c = p.bounds ? v3(p.bounds[0]).add(v3(p.bounds[1])).multiplyScalar(0.5) : new Vector3();
  // the bore snaps sit on the axis: prefer them
  for (const s of p.snapPoints) {
    if (s.type === 'm4_hole') continue;
    const n = v3(s.normal).normalize();
    if (Math.abs(Math.abs(n.dot(axis)) - 1) < 1e-3) {
      const pos = v3(s.position);
      const radial = pos.clone().sub(axis.clone().multiplyScalar(pos.dot(axis)));
      if (radial.length() < 6) return radial;
    }
  }
  return c.sub(axis.clone().multiplyScalar(c.dot(axis)));
}

/** Two toothed parts that are plausibly in mesh (teeth interpenetrate in CAD because tooth phase is arbitrary). */
export function plausibleMesh(a: ToothInfo, b: ToothInfo, centreDist: number, parallel: boolean) {
  if (a.kind === 'miter' && b.kind === 'miter') return !parallel;
  if (a.kind === 'rack' || b.kind === 'rack') return true;
  if (a.kind !== 'gear' || b.kind !== 'gear' || !parallel) return false;
  return Math.abs(centreDist - (a.r + b.r)) < Math.max(1.5, 0.06 * (a.r + b.r));
}

/**
 * Where the teeth of a gear / sprocket / pulley are, in the part frame: on the spin axis, at the middle of the
 * part along it (a set-screw sprocket's origin can sit at the end of its hub).
 */
export function toothCentreLocal(p: CatalogPart, axis: Vector3): Vector3 {
  const c = spinCentreLocal(p, axis);
  if (!p.bounds) return c;
  const mid = v3(p.bounds[0]).add(v3(p.bounds[1])).multiplyScalar(0.5);
  return c.addScaledVector(axis, mid.dot(axis));
}
