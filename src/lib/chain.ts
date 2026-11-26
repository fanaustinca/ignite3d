// Chains between two sprockets (the Chain tool).
//
// A chain is stored as an ordinary PlacedInstance of a chain SKU so that saving, undo, cloud files and share
// links all carry it unchanged: it sits at the midpoint between its two sprockets, with its local X pointing
// from one sprocket to the other and its local Y along the sprocket axes. The sprockets themselves are found
// again from that line every time (share links don't keep instance ids), so a chain follows its sprockets as
// long as they stay on that line.
import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, Quat, Vec3 } from '../types/cad';
import { instanceMatrix, q4 } from './snap';
import { spinAxisLocal, toothCentreLocal, toothInfo } from './drive/partInfo';

export interface ChainKind {
  sku: string;
  name: string;
  /** links per retail pack / length */
  perPack: number;
  gPerLink: number;
  price: number;
  color: string;
}
export const CHAIN_KINDS: ChainKind[] = [
  { sku: '3309-0108-0050', name: '3309 Series 8mm Pitch Plastic Chain (50 Links/400mm, Black)', perPack: 50, gPerLink: 0.42, price: 7.99, color: '#1d1f23' },
  { sku: '3308-0008-1000', name: '8mm Pitch Steel Chain (1 Meter Length)', perPack: 125, gPerLink: 192 / 125, price: 11.99, color: '#a9adb3' },
];
export const CHAIN_PITCH = 8;
export const isChainSku = (sku: string) => CHAIN_KINDS.some((k) => k.sku === sku);
export const chainKind = (sku: string) => CHAIN_KINDS.find((k) => k.sku === sku) ?? CHAIN_KINDS[0];

/** Catalogue entries for the chains (price / weight per pack; the BOM counts packs from the links used). */
export const CHAIN_PARTS: CatalogPart[] = CHAIN_KINDS.map((k) => ({
  sku: k.sku,
  name: k.name,
  category: 'Gears & Slides',
  series: 'Chain',
  massGrams: Math.round(k.gPerLink * k.perPack * 10) / 10,
  priceUsd: k.price,
  snapPoints: [],
  dimensions: [k.perPack * CHAIN_PITCH, 7.5, 4.6],
  bounds: [
    [-48, -3.75, -2.3],
    [48, 3.75, 2.3],
  ],
  tags: ['chain', 'roller chain', 'sprocket'],
  sourceUrl: k.sku.startsWith('3309') ? 'https://www.gobilda.com/3309-series-8mm-pitch-plastic-chain-50-links-400mm-black' : 'https://www.gobilda.com/8mm-pitch-steel-chain-1-meter-length',
}));

export interface Sprocket {
  inst: PlacedInstance;
  /** tooth-plane centre (world mm) */
  c: Vector3;
  /** spin axis (world, unit) */
  d: Vector3;
  /** pitch radius (mm) */
  r: number;
  teeth: number;
  pitch: number;
}

export function sprocketOf(inst: PlacedInstance, part: CatalogPart | undefined): Sprocket | null {
  if (!part) return null;
  const info = toothInfo(part);
  if (!info || info.kind !== 'sprocket') return null;
  const axL = spinAxisLocal(part);
  const c = toothCentreLocal(part, axL).applyMatrix4(instanceMatrix(inst));
  const d = axL.applyQuaternion(q4(inst.quaternion)).normalize();
  return { inst, c, d, r: info.r, teeth: info.teeth, pitch: info.pitch };
}

/** Pitch-line length of an open chain loop around two sprockets (mm). */
export function loopLength(d: number, r1: number, r2: number) {
  const s = Math.max(-0.999, Math.min(0.999, (r1 - r2) / d));
  const b = Math.asin(s);
  return 2 * d * Math.cos(b) + r1 * (Math.PI + 2 * b) + r2 * (Math.PI - 2 * b);
}

export interface ChainCheck {
  ok: boolean;
  reason?: string;
  links?: number;
  /** chain length minus the loop's pitch length (mm): small = tight, > ~1 pitch = slack */
  slack?: number;
}

/** Can these two sprockets take a chain? */
export function checkChain(a: Sprocket, b: Sprocket): ChainCheck {
  if (a.inst.instanceId === b.inst.instanceId) return { ok: false, reason: 'Pick two different sprockets.' };
  if (Math.abs(a.pitch - b.pitch) > 0.01) return { ok: false, reason: `Different chain pitch (${a.pitch} mm vs ${b.pitch} mm).` };
  if (Math.abs(a.d.dot(b.d)) < 0.995) return { ok: false, reason: 'The sprockets’ shafts aren’t parallel.' };
  const off = b.c.clone().sub(a.c);
  const axial = off.dot(a.d);
  if (Math.abs(axial) > 5) return { ok: false, reason: `The sprockets aren’t in line: ${Math.abs(axial).toFixed(1)} mm apart along the shaft. Move one with [ / ] first.` };
  const dist = off.addScaledVector(a.d, -axial).length();
  if (dist < a.r + b.r + 4) return { ok: false, reason: 'The sprockets are too close together for a chain.' };
  const L = loopLength(dist, a.r, b.r);
  let links = Math.ceil(L / a.pitch - 0.15);
  if (links % 2) links++;
  return { ok: true, links, slack: links * a.pitch - L };
}

/** Instance for a new chain between two sprockets. */
export function chainInstance(a: Sprocket, b: Sprocket, sku: string, instanceId: string): PlacedInstance {
  const mid = a.c.clone().add(b.c).multiplyScalar(0.5);
  const y = a.d.clone();
  const x = b.c.clone().sub(a.c).addScaledVector(y, -b.c.clone().sub(a.c).dot(y)).normalize();
  const z = x.clone().cross(y).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  return { instanceId, sku, position: mid.toArray() as Vec3, quaternion: [q.x, q.y, q.z, q.w] as Quat, hidden: false, ghosted: false };
}

export interface ResolvedChain {
  chain: PlacedInstance;
  kind: ChainKind;
  a: Sprocket;
  b: Sprocket;
  links: number;
  slack: number;
}

/** Find the two sprockets a chain instance runs around (null if they moved away / were deleted). */
export function resolveChain(chain: PlacedInstance, sprockets: Sprocket[]): ResolvedChain | null {
  const m = instanceMatrix(chain);
  const P = new Vector3().applyMatrix4(m);
  const q = q4(chain.quaternion);
  const X = new Vector3(1, 0, 0).applyQuaternion(q);
  const Y = new Vector3(0, 1, 0).applyQuaternion(q);
  const on: { s: Sprocket; t: number }[] = [];
  for (const s of sprockets) {
    if (Math.abs(s.d.dot(Y)) < 0.995) continue;
    const o = s.c.clone().sub(P);
    if (Math.abs(o.dot(Y)) > 5) continue;
    const t = o.dot(X);
    if (o.addScaledVector(X, -t).addScaledVector(Y, -o.dot(Y)).length() > 1.5) continue;
    on.push({ s, t });
  }
  let best: { a: Sprocket; b: Sprocket; e: number } | null = null;
  for (const A of on)
    for (const B of on) {
      if (A.t >= 0 || B.t <= 0) continue;
      const e = Math.abs(A.t + B.t);
      if (e < 1.5 && (!best || e < best.e)) best = { a: A.s, b: B.s, e };
    }
  if (!best) return null;
  const chk = checkChain(best.a, best.b);
  if (!chk.ok) return null;
  return { chain, kind: chainKind(chain.sku), a: best.a, b: best.b, links: chk.links!, slack: chk.slack! };
}

export function allSprockets(instances: PlacedInstance[], catalog: Record<string, CatalogPart>): Sprocket[] {
  const out: Sprocket[] = [];
  for (const i of instances) {
    if (i.hidden) continue;
    const s = sprocketOf(i, catalog[i.sku]);
    if (s) out.push(s);
  }
  return out;
}

export function resolveChains(instances: PlacedInstance[], catalog: Record<string, CatalogPart>) {
  const sp = allSprockets(instances, catalog);
  const out: { chain: PlacedInstance; resolved: ResolvedChain | null }[] = [];
  for (const i of instances) if (!i.hidden && isChainSku(i.sku)) out.push({ chain: i, resolved: resolveChain(i, sp) });
  return out;
}

/**
 * Points along the chain's pitch line, in the chain's own frame (mm; loop in the XZ plane, sprocket A at
 * −X, B at +X), evenly spaced one link apart, starting at `phase` mm along the loop.
 */
export function chainLinks(a: { r: number }, b: { r: number }, dist: number, n: number, phase = 0) {
  const r1 = a.r, r2 = b.r;
  const s = Math.max(-0.999, Math.min(0.999, (r1 - r2) / dist));
  const beta = Math.asin(s);
  const A = new Vector3(-dist / 2, 0, 0), B = new Vector3(dist / 2, 0, 0);
  // tangent points: both straight runs touch A and B where the shared normal is at ±(90° − β) from +X
  const ang = Math.PI / 2 - beta;
  const pt = (c: Vector3, r: number, t: number) => new Vector3(c.x + r * Math.cos(t), 0, c.z + r * Math.sin(t));
  // segments: top straight A->B, arc around B, bottom straight B->A, arc around A
  const segs: { len: number; at: (u: number) => { p: Vector3; dir: Vector3 } }[] = [];
  const line = (p0: Vector3, p1: Vector3) => {
    const dir = p1.clone().sub(p0);
    const len = dir.length();
    dir.normalize();
    segs.push({ len, at: (u) => ({ p: p0.clone().addScaledVector(dir, u), dir }) });
  };
  const arc = (c: Vector3, r: number, t0: number, t1: number) => {
    // clockwise when seen from +Y in XZ (t decreasing)
    const sweep = t0 - t1;
    segs.push({
      len: r * sweep,
      at: (u) => {
        const t = t0 - u / r;
        return { p: pt(c, r, t), dir: new Vector3(Math.sin(t), 0, -Math.cos(t)) };
      },
    });
  };
  line(pt(A, r1, ang), pt(B, r2, ang));
  arc(B, r2, ang, -ang);
  line(pt(B, r2, -ang), pt(A, r1, -ang));
  arc(A, r1, -ang, -2 * Math.PI + ang);
  const total = segs.reduce((x, g) => x + g.len, 0);
  const step = total / n;
  const out: { p: Vector3; dir: Vector3 }[] = [];
  for (let k = 0; k < n; k++) {
    let u = (((phase + k * step) % total) + total) % total;
    for (const g of segs) {
      if (u <= g.len) {
        out.push(g.at(u));
        break;
      }
      u -= g.len;
    }
  }
  return out;
}

/** Simple roller-chain link (two side plates + a roller), centred at the origin along +X. */
export function linkGeometry(pitch = CHAIN_PITCH) {
  const pos: number[] = [];
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const f = [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
    ];
    for (const [a, b, c, d] of f) pos.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  };
  // side plates (above / below the sprocket plane = ±Y), roller across them
  box(0, 2.6, 0, pitch * 0.98, 1.0, 4.4);
  box(0, -2.6, 0, pitch * 0.98, 1.0, 4.4);
  box(pitch / 2, 0, 0, 4.2, 4.2, 4.2);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Instance matrices (chain-local -> world through `frame`) of every link of a resolved chain. */
export function chainLinkMatrices(rc: ResolvedChain, phase = 0, frame?: Matrix4) {
  const dist = rc.a.c.distanceTo(rc.b.c);
  // chain frame: midpoint, X from A to B, Y along the axes (recomputed from the sprockets so it stays exact)
  const y = rc.a.d.clone();
  const x = rc.b.c.clone().sub(rc.a.c);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = x.clone().cross(y).normalize();
  const base = new Matrix4().makeBasis(x, y, z).setPosition(rc.a.c.clone().add(rc.b.c).multiplyScalar(0.5));
  if (frame) base.premultiply(frame);
  const pts = chainLinks(rc.a, rc.b, dist, rc.links, phase);
  const m = new Matrix4(), q = new Quaternion();
  return pts.map(({ p, dir }) => {
    q.setFromUnitVectors(new Vector3(1, 0, 0), dir);
    return base.clone().multiply(m.compose(p, q, new Vector3(1, 1, 1)));
  });
}
