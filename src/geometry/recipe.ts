// Procedural recipe -> triangle mesh + snap points + volume.
// One recipe drives the visible mesh, the snap points and the STEP export, so a
// visible hole and its snap point can never disagree.
import { ShapeUtils, Vector2 } from 'three';
import type { Extrusion, HoleSpec, Outline, Pt2, ProceduralRecipe, SnapPoint, Vec3 } from '../types/cad';

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function frameNormal(e: Extrusion): Vec3 {
  return norm3(cross3(e.frame.u, e.frame.v));
}

/** Map local (a, b, w) of an extrusion (w along the extrusion normal) to part space. */
export function mapPoint(e: Extrusion, a: number, b: number, w: number): Vec3 {
  const n = frameNormal(e);
  const { o, u, v } = e.frame;
  return [
    o[0] + u[0] * a + v[0] * b + n[0] * w,
    o[1] + u[1] * a + v[1] * b + n[1] * w,
    o[2] + u[2] * a + v[2] * b + n[2] * w,
  ];
}

export function circleSegments(r: number) {
  if (r <= 2.5) return 12;
  if (r <= 5) return 16;
  if (r <= 10) return 24;
  if (r <= 30) return 40;
  return 64;
}

export function circlePts(r: number, cx = 0, cy = 0, n = circleSegments(r)): Pt2[] {
  const pts: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

/** Hexagon with the given across-flats size (goBILDA REX shafts are an 8 mm hex profile). */
export function hexPts(acrossFlats: number, cx = 0, cy = 0, rot = 0): Pt2[] {
  const R = acrossFlats / Math.sqrt(3);
  const pts: Pt2[] = [];
  for (let i = 0; i < 6; i++) {
    const t = rot + (i / 6) * Math.PI * 2 + Math.PI / 6;
    pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]);
  }
  return pts;
}

/** D profile: circle of diameter d with one flat at 0.917·d (6 mm D-shaft flat at 5.5 mm). */
export function dPts(d: number, cx = 0, cy = 0): Pt2[] {
  const r = d / 2;
  const flat = r - d * 0.0833; // distance from centre to the flat
  const a0 = Math.acos(flat / r);
  const pts: Pt2[] = [];
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const t = a0 + (i / n) * (Math.PI * 2 - 2 * a0);
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

export function rectPts(x0: number, y0: number, x1: number, y1: number): Pt2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function gearPts(teeth: number, module: number): Pt2[] {
  const pr = (teeth * module) / 2;
  const ro = pr + module;
  const ri = pr - 1.25 * module;
  const pts: Pt2[] = [];
  for (let i = 0; i < teeth; i++) {
    const base = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    pts.push([ri * Math.cos(base), ri * Math.sin(base)]);
    pts.push([ro * Math.cos(base + step * 0.3), ro * Math.sin(base + step * 0.3)]);
    pts.push([ro * Math.cos(base + step * 0.5), ro * Math.sin(base + step * 0.5)]);
    pts.push([ri * Math.cos(base + step * 0.8), ri * Math.sin(base + step * 0.8)]);
  }
  return pts;
}

export function signedArea(pts: Pt2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

const ccw = (pts: Pt2[]) => (signedArea(pts) < 0 ? [...pts].reverse() : pts);
const cw = (pts: Pt2[]) => (signedArea(pts) > 0 ? [...pts].reverse() : pts);

export function outlinePts(o: Outline): Pt2[] {
  return o.kind === 'circle' ? circlePts(o.r, o.cx ?? 0, o.cy ?? 0) : o.pts;
}

export function holePts(h: HoleSpec): Pt2[] {
  switch (h.shape) {
    case 'rex':
      return hexPts(h.d, h.x, h.y);
    case 'dshaft':
      return dPts(h.d, h.x, h.y);
    case 'square':
      return rectPts(h.x - h.d / 2, h.y - h.d / 2, h.x + h.d / 2, h.y + h.d / 2);
    default:
      return circlePts(h.d / 2, h.x, h.y);
  }
}

export function holeArea(h: HoleSpec) {
  if (h.shape === 'circle' || !h.shape) return Math.PI * (h.d / 2) ** 2;
  return Math.abs(signedArea(holePts(h)));
}

export function outlineArea(o: Outline) {
  return o.kind === 'circle' ? Math.PI * o.r * o.r : Math.abs(signedArea(o.pts));
}

/** Exact prism volume in mm³ (circles treated analytically). */
export function extrusionVolume(e: Extrusion) {
  const holes = (e.holes ?? []).reduce((s, h) => s + holeArea(h), 0);
  return (outlineArea(e.outline) - holes) * e.depth;
}

export function recipeVolume(r: ProceduralRecipe) {
  return r.solids.reduce((s, e) => s + extrusionVolume(e), 0);
}

/** Triangulate a recipe into non-indexed position arrays grouped by colour. */
export function triangulateRecipe(r: ProceduralRecipe): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const e of r.solids) {
    const arr = out.get(e.color) ?? [];
    out.set(e.color, arr);
    triangulateExtrusion(e, arr);
  }
  return out;
}

function pushTri(arr: number[], a: Vec3, b: Vec3, c: Vec3) {
  arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

export function triangulateExtrusion(e: Extrusion, arr: number[]) {
  const outer = ccw(outlinePts(e.outline));
  const holes = (e.holes ?? []).map((h) => cw(holePts(h)));
  const contour = outer.map((p) => new Vector2(p[0], p[1]));
  const holeVecs = holes.map((h) => h.map((p) => new Vector2(p[0], p[1])));
  const all: Pt2[] = [...outer, ...holes.flat()];
  const tris = ShapeUtils.triangulateShape(contour, holeVecs);
  const d = e.depth;
  for (const t of tris) {
    let [i, j, k] = t;
    const A = all[i], B = all[j], C = all[k];
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (area < 0) [j, k] = [k, j];
    const a = all[i], b = all[j], c = all[k];
    // top (+n): CCW
    pushTri(arr, mapPoint(e, a[0], a[1], d), mapPoint(e, b[0], b[1], d), mapPoint(e, c[0], c[1], d));
    // bottom (-n): CW
    pushTri(arr, mapPoint(e, a[0], a[1], 0), mapPoint(e, c[0], c[1], 0), mapPoint(e, b[0], b[1], 0));
  }
  const ring = (pts: Pt2[]) => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const b0 = mapPoint(e, p[0], p[1], 0);
      const b1 = mapPoint(e, q[0], q[1], 0);
      const t0 = mapPoint(e, p[0], p[1], d);
      const t1 = mapPoint(e, q[0], q[1], d);
      pushTri(arr, b0, b1, t1);
      pushTri(arr, b0, t1, t0);
    }
  };
  ring(outer);
  holes.forEach(ring);
}

/** Snap points derived from holes: one per face, normals pointing out of the material. */
export function snapsFromRecipe(r: ProceduralRecipe): SnapPoint[] {
  const snaps: SnapPoint[] = [];
  r.solids.forEach((e, si) => {
    const n = frameNormal(e);
    const up = norm3(e.frame.u);
    (e.holes ?? []).forEach((h, hi) => {
      if (!h.snap || h.snap === 'none') return;
      const holeId = `s${si}h${hi}`;
      if (!e.noSnapFaces?.includes('bottom'))
        snaps.push({
          id: `${holeId}b`,
          type: h.snap,
          position: round3(mapPoint(e, h.x, h.y, 0)),
          normal: round3(scale3(n, -1)),
          upVector: round3(up),
          depth: e.depth,
          tapped: h.tapped || undefined,
          holeId,
        });
      if (!e.noSnapFaces?.includes('top'))
        snaps.push({
          id: `${holeId}t`,
          type: h.snap,
          position: round3(mapPoint(e, h.x, h.y, e.depth)),
          normal: round3(n),
          upVector: round3(up),
          depth: e.depth,
          tapped: h.tapped || undefined,
          holeId,
        });
    });
  });
  return [...snaps, ...(r.extraSnaps ?? [])];
}

export const round3 = (v: Vec3): Vec3 => [rnd(v[0]), rnd(v[1]), rnd(v[2])];
export const rnd = (x: number) => {
  const r = Math.round(x * 1e4) / 1e4;
  return r === 0 ? 0 : r; // no -0
};

export function recipeBounds(r: ProceduralRecipe): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const e of r.solids) {
    const pts = outlinePts(e.outline);
    for (const p of pts)
      for (const w of [0, e.depth]) {
        const q = mapPoint(e, p[0], p[1], w);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], q[i]);
          max[i] = Math.max(max[i], q[i]);
        }
      }
  }
  return { min: round3(min), max: round3(max) };
}
