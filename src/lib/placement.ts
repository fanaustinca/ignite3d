// Placement helpers shared by the viewport ghost and the tests.
import { Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, SnapPoint } from '../types/cad';
import { mateTransform, type WorldSnap } from './snap';

/**
 * Which of the 4 quarter-turns about the mating axis fits best: every ghost hole face that lands on an
 * opposed hole face of the target part scores +1 (faces pressed together), every one that lands on a face
 * pointing the same way scores -2 (the ghost's material would sit inside the target's).
 */
export function bestAlignment(anchor: SnapPoint, target: WorldSnap, part: CatalogPart, targetSnaps: WorldSnap[]) {
  const hk = (v: Vector3) => `${Math.round(v.x * 4)},${Math.round(v.y * 4)},${Math.round(v.z * 4)}`;
  const hash = new Map<string, Vector3[]>();
  for (const s of targetSnaps) {
    const k = hk(s.pos);
    const l = hash.get(k);
    if (l) l.push(s.normal);
    else hash.set(k, [s.normal]);
  }
  let best = 0;
  let bestN = -Infinity;
  const v = new Vector3();
  const n = new Vector3();
  for (let k = 0; k < 4; k++) {
    const m = mateTransform(anchor, target, (k * Math.PI) / 2);
    let score = 0;
    for (const s of part.snapPoints) {
      if (s.male) continue;
      v.set(...s.position).applyQuaternion(m.quaternion).add(m.position);
      const hit = hash.get(hk(v));
      if (!hit) continue;
      n.set(...s.normal).applyQuaternion(m.quaternion);
      for (const tn of hit) score += tn.dot(n) < -0.99 ? 1 : tn.dot(n) > 0.99 ? -2 : 0;
    }
    if (score > bestN) {
      bestN = score;
      best = k;
    }
  }
  return best;
}

/** Hole faces already pressed against another part's hole face (opposed) — nothing else can mount there. */
export function occupiedFaces(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, snapsOf: (i: PlacedInstance, p: CatalogPart) => WorldSnap[]) {
  const hk = (v: Vector3) => `${Math.round(v.x * 4)},${Math.round(v.y * 4)},${Math.round(v.z * 4)}`;
  const by = new Map<string, WorldSnap[]>();
  for (const i of instances) {
    const part = catalog[i.sku];
    if (i.hidden || !part) continue;
    for (const s of snapsOf(i, part)) {
      if (s.snap.male) continue;
      const k = hk(s.pos);
      const l = by.get(k);
      if (l) l.push(s);
      else by.set(k, [s]);
    }
  }
  const out = new Set<WorldSnap>();
  for (const l of by.values())
    for (const a of l) for (const b of l) if (a.instanceId !== b.instanceId && a.normal.dot(b.normal) < -0.99) out.add(a);
  return out;
}

