// Small helpers for writing procedural part recipes in world (part-local) coordinates.
// Axis conventions for extrusions:
//   'y' : outline in (x, -z), extruded +Y from y0        (horizontal plates, discs)
//   'z' : outline in (x,  y), extruded +Z from z0        (vertical plates facing Z)
//   'x' : outline in (y,  z), extruded +X from x0        (vertical plates facing X, wheels)
import type { Extrusion, HoleSpec, Outline, Pt2, SnapPoint, SnapType, Vec3 } from '../types/cad';
import { circlePts, cross3, norm3, rectPts, scale3, add3 } from '../geometry/recipe';

export const C = {
  alu: '#c4c8ce',
  aluDark: '#9aa0a8',
  steel: '#8d939b',
  black: '#2b2d31',
  oxide: '#3a3c40',
  yellow: '#f2c200',
  rubber: '#26282c',
  roller: '#80868f',
  brass: '#c8a24a',
  thread: '#121316',
  bluePlastic: '#2f6fd6',
  servo: '#1d1f22',
};

export const M4 = 4.3; // clearance
export const m4 = (x: number, y: number, tapped = false, snap: SnapType = 'm4_hole'): HoleSpec => ({
  x,
  y,
  d: tapped ? 3.4 : M4,
  snap,
  tapped: tapped || undefined,
});
export const bore14 = (x = 0, y = 0): HoleSpec => ({ x, y, d: 14, snap: 'bearing_14mm' });
export const rexHole = (x = 0, y = 0, snap: SnapType | 'none' = 'rex_8mm'): HoleSpec => ({
  x,
  y,
  d: 8,
  shape: 'rex',
  snap,
});
export const roundHole = (d: number, x = 0, y = 0, snap: SnapType | 'none' = 'none'): HoleSpec => ({ x, y, d, snap });
export const dHole = (x = 0, y = 0, snap: SnapType | 'none' = 'd_6mm'): HoleSpec => ({ x, y, d: 6, shape: 'dshaft', snap });

type Axis = 'x' | 'y' | 'z';

/** Convert a world-plane coordinate pair to the extrusion's local (a, b). */
function toLocal(axis: Axis, p: Pt2): Pt2 {
  return axis === 'y' ? [p[0], -p[1]] : p;
}

export interface ExtOpts {
  holes?: HoleSpec[];
  color: string;
  noSnapFaces?: ('bottom' | 'top')[];
  decal?: boolean;
}

/**
 * Generic prism. `outline` and holes are in the world plane coordinates for the
 * axis (see header), `start` is the coordinate along the axis where extrusion starts.
 */
export function prism(axis: Axis, start: number, depth: number, outline: Outline, opts: ExtOpts): Extrusion {
  const frame =
    axis === 'y'
      ? { o: [0, start, 0] as Vec3, u: [1, 0, 0] as Vec3, v: [0, 0, -1] as Vec3 }
      : axis === 'z'
        ? { o: [0, 0, start] as Vec3, u: [1, 0, 0] as Vec3, v: [0, 1, 0] as Vec3 }
        : { o: [start, 0, 0] as Vec3, u: [0, 1, 0] as Vec3, v: [0, 0, 1] as Vec3 };
  const local: Outline =
    outline.kind === 'circle'
      ? (() => {
          const [cx, cy] = toLocal(axis, [outline.cx ?? 0, outline.cy ?? 0]);
          return { kind: 'circle', r: outline.r, cx, cy };
        })()
      : { kind: 'poly', pts: outline.pts.map((p) => toLocal(axis, p)) };
  return {
    outline: local,
    holes: (opts.holes ?? []).map((h) => {
      const [x, y] = toLocal(axis, [h.x, h.y]);
      return { ...h, x, y };
    }),
    frame,
    depth,
    color: opts.color,
    noSnapFaces: opts.noSnapFaces,
    decal: opts.decal,
  };
}

export const rect = (a0: number, b0: number, a1: number, b1: number): Outline => ({
  kind: 'poly',
  pts: rectPts(Math.min(a0, a1), Math.min(b0, b1), Math.max(a0, a1), Math.max(b0, b1)),
});
export const circle = (r: number, cx = 0, cy = 0): Outline => ({ kind: 'circle', r, cx, cy });
export const poly = (pts: Pt2[]): Outline => ({ kind: 'poly', pts });

/** Rounded rectangle outline. */
export function rrect(w: number, h: number, r: number, cx = 0, cy = 0): Outline {
  const pts: Pt2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, 90],
    [-w / 2 + r, -h / 2 + r, 180],
    [w / 2 - r, -h / 2 + r, 270],
  ];
  for (const [x, y, a0] of corners)
    for (let i = 0; i <= 6; i++) {
      const t = ((a0 + (i / 6) * 90) * Math.PI) / 180;
      pts.push([cx + x + r * Math.cos(t), cy + y + r * Math.sin(t)]);
    }
  return { kind: 'poly', pts };
}

/** Prism on an arbitrary frame (used for tilted rollers etc.). Holes are in local coords. */
export function framed(o: Vec3, u: Vec3, v: Vec3, depth: number, outline: Outline, opts: ExtOpts): Extrusion {
  return { outline, holes: opts.holes ?? [], frame: { o, u, v }, depth, color: opts.color, noSnapFaces: opts.noSnapFaces, decal: opts.decal };
}

/** Thread marker on a blind tapped hole + its snap point (normal = outward face normal). */
export function tappedHole(id: string, pos: Vec3, normal: Vec3, up: Vec3): { solid: Extrusion; snap: SnapPoint } {
  const n = norm3(normal);
  const u = norm3(up);
  const v = cross3(n, u);
  const o = add3(pos, scale3(n, -0.3));
  return {
    solid: framed(o, u, v, 0.36, circle(1.7), { color: C.thread, decal: true }),
    snap: { id, type: 'm4_hole', position: pos, normal: n, upVector: u, depth: 0, tapped: true, holeId: id },
  };
}

export function male(id: string, type: SnapType, position: Vec3, normal: Vec3, upVector: Vec3 = [1, 0, 0]): SnapPoint {
  return { id, type, position, normal, upVector, male: true };
}

/** A pair of female snap points for a hole that spans several solids (e.g. a hub bore). */
export function throughHole(id: string, type: SnapType, a: Vec3, b: Vec3, up: Vec3 = [1, 0, 0]): SnapPoint[] {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const depth = Math.hypot(...d);
  const n = norm3(d);
  return [
    { id: `${id}a`, type, position: a, normal: scale3(n, -1), upVector: up, depth, holeId: id },
    { id: `${id}b`, type, position: b, normal: n, upVector: up, depth, holeId: id },
  ];
}

export { circlePts };
