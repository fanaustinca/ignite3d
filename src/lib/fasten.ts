// Smart Fasten: find the stack of aligned M4 holes through a joint, pick a screw
// length, and compute screw + locknut transforms.
import { Quaternion, Vector3 } from 'three';
import type { Quat, Vec3 } from '../types/cad';
import { NUT_HEIGHT, SCREW_LENGTHS } from '../data/catalog';
import { distToLine, toQuat, toVec3, type WorldSnap } from './snap';

const AXIS_TOL = 0.3; // mm off-axis allowed
const FACE_TOL = 0.35; // mm gap allowed between stacked faces
const FASTENABLE = new Set(['m4_hole', 'hub_pattern_16mm']);

export interface StackLayer {
  instanceId: string;
  sku: string;
  start: number; // t along the screw axis where the layer's entry face is
  depth: number;
  tapped: boolean;
}

export interface FastenPlan {
  ok: true;
  layers: StackLayer[];
  /** Clearance thickness the screw passes through (mm). */
  grip: number;
  /** Screw ends in a threaded part (tapped hole / standoff / nut) instead of needing a nut. */
  threadedEnd: boolean;
  screwLength: number;
  screw: { position: Vec3; quaternion: Quat };
  nut?: { position: Vec3; quaternion: Quat };
  head: Vector3;
  dir: Vector3;
  warning?: string;
}
export interface FastenFail {
  ok: false;
  reason: string;
}

/** Thread engagement available in a tapped feature of a given depth. */
function threadCapacity(depth: number) {
  return depth > 0 ? Math.min(depth, 12) : 6; // blind tapped holes in blocks / motor faces ≈ 6 mm deep
}

export function chooseScrew(grip: number, threadedEnd: boolean, tappedDepth: number): { length: number; warning?: string } | null {
  if (threadedEnd) {
    const cap = threadCapacity(tappedDepth);
    const fit = SCREW_LENGTHS.filter((L) => L >= grip + Math.min(4, cap) && L <= grip + cap);
    if (fit.length) return { length: fit[0] };
    const longer = SCREW_LENGTHS.find((L) => L >= grip + 2 && L <= grip + cap);
    if (longer) return { length: longer, warning: 'Short thread engagement' };
    return null;
  }
  const L = SCREW_LENGTHS.find((x) => x >= grip + NUT_HEIGHT);
  return L ? { length: L } : null;
}

/**
 * Starting at a clicked hole face, walk along the hole axis collecting the stack of
 * coaxial, touching hole layers in both directions. The head goes on the outermost
 * clearance face; the screw ends at a tapped layer or a locknut on the far face.
 */
export function planFasten(clicked: WorldSnap, all: WorldSnap[], _depth = 0): FastenPlan | FastenFail {
  if (_depth > 3) return { ok: false, reason: 'Could not resolve the joint direction.' };
  if (!FASTENABLE.has(clicked.snap.type) || clicked.snap.male) return { ok: false, reason: 'Pick an M4 hole to fasten.' };
  const origin = clicked.pos.clone();
  const dir = clicked.normal.clone().negate(); // into the material

  const onAxis = all.filter(
    (s) =>
      FASTENABLE.has(s.snap.type) &&
      !s.snap.male &&
      Math.abs(Math.abs(s.normal.dot(dir)) - 1) < 0.004 &&
      distToLine(s.pos, origin, dir) < AXIS_TOL,
  );
  const tOf = (s: WorldSnap) => s.pos.clone().sub(origin).dot(dir);
  // entry faces face back toward the head (normal·dir < 0)
  const entries = onAxis.filter((s) => s.normal.dot(dir) < 0);
  const exits = onAxis.filter((s) => s.normal.dot(dir) > 0);

  // 1) If the clicked face is a threaded hole, flip so the head is on the other side.
  if (clicked.snap.tapped) {
    // Screw comes from the side the clicked face looks at: find a clearance layer pressed against it.
    const facing = exits.filter((s) => s.instanceId !== clicked.instanceId && Math.abs(tOf(s)) < FACE_TOL && !s.snap.tapped);
    if (!facing.length) return { ok: false, reason: 'That threaded hole has no part bolted over it yet.' };
    // restart from the outer face of the clearance part covering it
    const f = facing[0];
    const outer = onAxis.find((s) => s.instanceId === f.instanceId && s.snap.holeId === f.snap.holeId && s !== f);
    if (!outer) return { ok: false, reason: 'Could not find the outer face of the covering part.' };
    return planFasten(outer, all, _depth + 1);
  }

  // 2) Walk backwards (against dir) to the outermost clearance face.
  let start = 0;
  const used = new Set<string>([clicked.instanceId]);
  for (let guard = 0; guard < 20; guard++) {
    const behind = exits.find((s) => !used.has(s.instanceId) && Math.abs(tOf(s) - start) < FACE_TOL);
    if (!behind) break;
    // a threaded part is behind us: the head must go on the other side of the stack
    if (behind.snap.tapped) return planFasten(behind, all, _depth + 1);
    used.add(behind.instanceId);
    start -= behind.snap.depth ?? 0;
  }

  // 3) Walk forward from `start`.
  const layers: StackLayer[] = [];
  let cur = start;
  const seen = new Set<string>();
  let threadedEnd = false;
  let tappedDepth = 0;
  for (let guard = 0; guard < 20; guard++) {
    const e = entries
      .filter((s) => !seen.has(s.instanceId) && Math.abs(tOf(s) - cur) < FACE_TOL)
      .sort((a, b) => Number(!!a.snap.tapped) - Number(!!b.snap.tapped))[0];
    if (!e) break;
    seen.add(e.instanceId);
    const depth = e.snap.depth ?? 0;
    layers.push({ instanceId: e.instanceId, sku: e.sku, start: cur, depth, tapped: !!e.snap.tapped });
    if (e.snap.tapped) {
      threadedEnd = true;
      tappedDepth = depth;
      break;
    }
    cur += depth;
  }
  if (!layers.length) return { ok: false, reason: 'No hole layer found at that point.' };
  const clearance = layers.filter((l) => !l.tapped);
  if (!clearance.length) return { ok: false, reason: 'Nothing to clamp: that hole is threaded.' };
  const partsInJoint = new Set(layers.map((l) => l.instanceId));
  if (partsInJoint.size < 2) return { ok: false, reason: 'No aligned hole on another part — line two parts up first (Snap ON).' };

  const grip = clearance.reduce((s, l) => s + l.depth, 0);
  const pick = chooseScrew(grip, threadedEnd, tappedDepth);
  if (!pick) return { ok: false, reason: `Stack is ${grip.toFixed(1)} mm thick — too thick for a 40 mm M4 screw.` };

  const head = origin.clone().add(dir.clone().multiplyScalar(start));
  const screwQ = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir);
  const plan: FastenPlan = {
    ok: true,
    layers,
    grip,
    threadedEnd,
    screwLength: pick.length,
    screw: { position: toVec3(head), quaternion: toQuat(screwQ) },
    head,
    dir: dir.clone(),
    warning: pick.warning,
  };
  if (!threadedEnd) {
    const exitPt = origin.clone().add(dir.clone().multiplyScalar(start + grip));
    const nutQ = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    plan.nut = { position: toVec3(exitPt), quaternion: toQuat(nutQ) };
  }
  return plan;
}

/** Key identifying one screw location (head point + direction), so a joint is never fastened twice. */
export function axisKey(head: Vector3, dir: Vector3) {
  const d = dir.clone().normalize();
  const r = (x: number) => Math.round(x * 2) / 2;
  return [r(head.x), r(head.y), r(head.z), Math.round(d.x * 100), Math.round(d.y * 100), Math.round(d.z * 100)].join(',');
}

/**
 * Pick up to `max` items spread as far apart as possible (greedy farthest-point), treating
 * `seeds` (e.g. screws already in the joint) as already chosen.
 */
export function spreadPick<T>(items: T[], pos: (t: T) => Vector3, max: number, seeds: Vector3[] = []): T[] {
  if (max <= 0) return [];
  if (items.length <= max && !seeds.length) return items;
  const chosenPos: Vector3[] = [...seeds];
  const chosen: T[] = [];
  if (!chosenPos.length) {
    const c = items.reduce((a, t) => a.add(pos(t)), new Vector3()).multiplyScalar(1 / items.length);
    let first = items[0];
    let best = -1;
    for (const t of items) {
      const d = pos(t).distanceTo(c);
      if (d > best) {
        best = d;
        first = t;
      }
    }
    chosen.push(first);
    chosenPos.push(pos(first));
  }
  while (chosen.length < max) {
    let pick: T | null = null;
    let pd = -1;
    for (const t of items) {
      if (chosen.includes(t)) continue;
      const d = Math.min(...chosenPos.map((c2) => c2.distanceTo(pos(t))));
      if (d > pd) {
        pd = d;
        pick = t;
      }
    }
    if (!pick) break;
    chosen.push(pick);
    chosenPos.push(pos(pick));
  }
  return chosen;
}
