// STEP AP214 assembly writer.
// - One PRODUCT per distinct SKU (B-rep written once), one NEXT_ASSEMBLY_USAGE_OCCURRENCE
//   per placed instance with its rigid transform -> Onshape imports it as an Assembly
//   with one Part Studio per SKU and correctly placed instances.
// - Procedural parts become exact ADVANCED_BREP solids: planar faces + true circular
//   holes (CYLINDRICAL_SURFACE / CIRCLE), so Onshape mate connectors snap to hole axes.
// - Parts without a recipe (custom uploads) are written as faceted surface models.
// - Units: millimetres. Orientation: converted from Three.js Y-up to CAD Z-up.
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { CatalogPart, Extrusion, PlacedInstance, Pt2, Vec3 } from '../types/cad';
import { frameNormal, holePts, mapPoint, norm3, outlinePts, signedArea, cross3, sub3 } from '../geometry/recipe';

/** Real goBILDA B-rep, already in the part frame, as a renumberable STEP DATA section. */
export interface StepFragment {
  maxId: number;
  pd: number; // PRODUCT_DEFINITION
  rep: number; // shape representation holding the solids
  origin: number; // AXIS2_PLACEMENT_3D item of that representation
  data: string; // '#1=...;#2=...;' entities
}

export interface StepOptions {
  name?: string;
  /** Exact manufacturer geometry per SKU (preferred over the procedural model). */
  fragments?: Record<string, StepFragment | undefined>;
  /** Triangle positions for parts without a procedural recipe (custom uploads). */
  meshFor?: (sku: string) => Float32Array | number[] | null;
  /** Convert Y-up to Z-up (default true). */
  zUp?: boolean;
}

const f = (x: number) => {
  if (!isFinite(x)) x = 0;
  let s = (Math.round(x * 1e6) / 1e6).toString();
  if (s === '-0') s = '0';
  if (s.includes('e')) s = x.toExponential(6).replace('e', 'E');
  else if (!s.includes('.')) s += '.';
  return s;
};
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_');

class Writer {
  lines: string[] = [];
  n = 0;
  add(body: string) {
    this.n++;
    this.lines.push(`#${this.n}=${body};`);
    return `#${this.n}`;
  }
  pt(p: Vec3) {
    return this.add(`CARTESIAN_POINT('',(${f(p[0])},${f(p[1])},${f(p[2])}))`);
  }
  dir(d: Vec3) {
    const n = norm3(d);
    return this.add(`DIRECTION('',(${f(n[0])},${f(n[1])},${f(n[2])}))`);
  }
  ax2(o: Vec3, z: Vec3, x: Vec3) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.pt(o)},${this.dir(z)},${this.dir(x)})`);
  }
}

type Ring =
  | { kind: 'poly'; pts: Pt2[] }
  | { kind: 'circle'; c: Pt2; r: number };

/** Write one extrusion as a MANIFOLD_SOLID_BREP; returns its entity ref. */
function writeExtrusion(w: Writer, e: Extrusion): string {
  const n = frameNormal(e);
  const u = norm3(e.frame.u);
  const d = e.depth;
  const rings: { ring: Ring; hole: boolean }[] = [];
  if (e.outline.kind === 'circle') rings.push({ ring: { kind: 'circle', c: [e.outline.cx ?? 0, e.outline.cy ?? 0], r: e.outline.r }, hole: false });
  else {
    const pts = signedArea(e.outline.pts) < 0 ? [...e.outline.pts].reverse() : e.outline.pts;
    rings.push({ ring: { kind: 'poly', pts }, hole: false });
  }
  for (const h of e.holes ?? []) {
    if (!h.shape || h.shape === 'circle') rings.push({ ring: { kind: 'circle', c: [h.x, h.y], r: h.d / 2 }, hole: true });
    else {
      const pts = holePts(h);
      rings.push({ ring: { kind: 'poly', pts: signedArea(pts) > 0 ? [...pts].reverse() : pts }, hole: true });
    }
  }

  const faces: string[] = [];
  const topBounds: string[] = [];
  const botBounds: string[] = [];
  const line = (a: Vec3, b: Vec3, va: string, vb: string) => {
    const dv = sub3(b, a);
    const vec = w.add(`VECTOR('',${w.dir(dv)},1.)`);
    const ln = w.add(`LINE('',${w.pt(a)},${vec})`);
    return w.add(`EDGE_CURVE('',${va},${vb},${ln},.T.)`);
  };
  const oe = (edge: string, sense: boolean) => w.add(`ORIENTED_EDGE('',*,*,${edge},${sense ? '.T.' : '.F.'})`);
  const loop = (oes: string[]) => w.add(`EDGE_LOOP('',(${oes.join(',')}))`);

  for (const { ring, hole } of rings) {
    if (ring.kind === 'circle') {
      const [cx, cy] = ring.c;
      const cb = mapPoint(e, cx, cy, 0);
      const ct = mapPoint(e, cx, cy, d);
      const pb = mapPoint(e, cx + ring.r, cy, 0);
      const ptp = mapPoint(e, cx + ring.r, cy, d);
      const vb = w.add(`VERTEX_POINT('',${w.pt(pb)})`);
      const vt = w.add(`VERTEX_POINT('',${w.pt(ptp)})`);
      const circB = w.add(`CIRCLE('',${w.ax2(cb, n, u)},${f(ring.r)})`);
      const circT = w.add(`CIRCLE('',${w.ax2(ct, n, u)},${f(ring.r)})`);
      const eb = w.add(`EDGE_CURVE('',${vb},${vb},${circB},.T.)`);
      const et = w.add(`EDGE_CURVE('',${vt},${vt},${circT},.T.)`);
      const es = line(pb, ptp, vb, vt);
      const surf = w.add(`CYLINDRICAL_SURFACE('',${w.ax2(cb, n, u)},${f(ring.r)})`);
      if (!hole) {
        const lp = loop([oe(eb, true), oe(es, true), oe(et, false), oe(es, false)]);
        faces.push(w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${lp},.T.)`)}),${surf},.T.)`));
        topBounds.push(w.add(`FACE_OUTER_BOUND('',${loop([oe(et, true)])},.T.)`));
        botBounds.push(w.add(`FACE_OUTER_BOUND('',${loop([oe(eb, false)])},.T.)`));
      } else {
        const lp = loop([oe(es, true), oe(et, true), oe(es, false), oe(eb, false)]);
        faces.push(w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${lp},.T.)`)}),${surf},.F.)`));
        topBounds.push(w.add(`FACE_BOUND('',${loop([oe(et, false)])},.T.)`));
        botBounds.push(w.add(`FACE_BOUND('',${loop([oe(eb, true)])},.T.)`));
      }
    } else {
      const pts = ring.pts;
      const m = pts.length;
      const B = pts.map((p) => mapPoint(e, p[0], p[1], 0));
      const T = pts.map((p) => mapPoint(e, p[0], p[1], d));
      const VB = B.map((p) => w.add(`VERTEX_POINT('',${w.pt(p)})`));
      const VT = T.map((p) => w.add(`VERTEX_POINT('',${w.pt(p)})`));
      const EB: string[] = [];
      const ET: string[] = [];
      const EV: string[] = [];
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        EB.push(line(B[i], B[j], VB[i], VB[j]));
        ET.push(line(T[i], T[j], VT[i], VT[j]));
        EV.push(line(B[i], T[i], VB[i], VT[i]));
      }
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const edge = sub3(B[j], B[i]);
        const nrm = cross3(edge, n);
        const pl = w.add(`PLANE('',${w.ax2(B[i], nrm, edge)})`);
        const lp = loop([oe(EB[i], true), oe(EV[j], true), oe(ET[i], false), oe(EV[i], false)]);
        faces.push(w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${lp},.T.)`)}),${pl},.T.)`));
      }
      const top = loop(ET.map((x) => oe(x, true)));
      const bot = loop([...EB].reverse().map((x) => oe(x, false)));
      topBounds.push(w.add(`${hole ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',${top},.T.)`));
      botBounds.push(w.add(`${hole ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',${bot},.T.)`));
    }
  }
  const o = e.frame.o;
  const topPl = w.add(`PLANE('',${w.ax2(mapPoint(e, 0, 0, d), n, u)})`);
  const botPl = w.add(`PLANE('',${w.ax2(o, [-n[0], -n[1], -n[2]], u)})`);
  faces.push(w.add(`ADVANCED_FACE('',(${topBounds.join(',')}),${topPl},.T.)`));
  faces.push(w.add(`ADVANCED_FACE('',(${botBounds.join(',')}),${botPl},.T.)`));
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP('',${shell})`);
}

/** Faceted surface model for meshes (custom parts). */
function writeMesh(w: Writer, tris: ArrayLike<number>): string {
  const vmap = new Map<string, string>();
  const pmap = new Map<string, Vec3>();
  const emap = new Map<string, { e: string; a: string }>();
  const vert = (i: number) => {
    const p: Vec3 = [tris[i], tris[i + 1], tris[i + 2]];
    const k = p.map((x) => x.toFixed(4)).join(',');
    let v = vmap.get(k);
    if (!v) {
      v = w.add(`VERTEX_POINT('',${w.pt(p)})`);
      vmap.set(k, v);
      pmap.set(v, p);
    }
    return v;
  };
  const faces: string[] = [];
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const vs = [vert(t), vert(t + 3), vert(t + 6)];
    if (vs[0] === vs[1] || vs[1] === vs[2] || vs[0] === vs[2]) continue;
    const P = vs.map((v) => pmap.get(v)!);
    const nrm = cross3(sub3(P[1], P[0]), sub3(P[2], P[0]));
    if (Math.hypot(...nrm) < 1e-9) continue;
    const oes = vs.map((a, i) => {
      const b = vs[(i + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      let rec = emap.get(key);
      if (!rec) {
        const pa = pmap.get(a)!;
        const pb = pmap.get(b)!;
        const vec = w.add(`VECTOR('',${w.dir(sub3(pb, pa))},1.)`);
        const ln = w.add(`LINE('',${w.pt(pa)},${vec})`);
        rec = { e: w.add(`EDGE_CURVE('',${a},${b},${ln},.T.)`), a };
        emap.set(key, rec);
      }
      return w.add(`ORIENTED_EDGE('',*,*,${rec.e},${rec.a === a ? '.T.' : '.F.'})`);
    });
    const lp = w.add(`EDGE_LOOP('',(${oes.join(',')}))`);
    const pl = w.add(`PLANE('',${w.ax2(P[0], nrm, sub3(P[1], P[0]))})`);
    faces.push(w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${lp},.T.)`)}),${pl},.T.)`));
  }
  const shell = w.add(`OPEN_SHELL('',(${faces.join(',')}))`);
  return w.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`);
}

/** Y-up -> Z-up rotation (+90° about X). */
const ZUP = new Matrix4().makeRotationX(Math.PI / 2);

export function exportStep(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, opts: StepOptions = {}): string {
  const w = new Writer();
  const name = esc(opts.name ?? 'Ignite3D Robot');
  const ctxApp = w.add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctxApp})`);
  const lenU = w.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angU = w.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solU = w.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-04),${lenU},'distance_accuracy_value','confusion accuracy')`);
  const ctx = w.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lenU},${angU},${solU}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  );
  const prodCtx = w.add(`PRODUCT_CONTEXT('',${ctxApp},'mechanical')`);
  const pdCtx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctxApp},'design')`);

  const product = (pname: string, id: string, kind: 'part' | 'assembly') => {
    const p = w.add(`PRODUCT('${esc(id)}','${esc(pname)}','',(${prodCtx}))`);
    w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('${kind}',$,(${p}))`);
    const pf = w.add(`PRODUCT_DEFINITION_FORMATION('','',${p})`);
    const pd = w.add(`PRODUCT_DEFINITION('design','',${pf},${pdCtx})`);
    const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    return { pd, pds };
  };

  // root assembly
  const root = product(name, name, 'assembly');
  const rootOrigin = w.ax2([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const rootItems: string[] = [rootOrigin];
  const rootRepIdx = w.lines.length; // placeholder index; filled after instances
  const rootRep = w.add(`SHAPE_REPRESENTATION('${name}',(__ROOT_ITEMS__),${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${root.pds},${rootRep})`);

  const parts = new Map<string, { pd: string; rep: string; origin: string }>();
  const visible = instances.filter((i) => !i.hidden);
  for (const sku of [...new Set(visible.map((i) => i.sku))]) {
    const cp = catalog[sku];
    if (!cp) continue;
    const frag = opts.fragments?.[sku];
    if (frag) {
      // splice the manufacturer's B-rep with entity ids shifted past ours
      const off = w.n;
      w.lines.push(frag.data.replace(/#(\d+)/g, (_, d) => `#${Number(d) + off}`));
      w.n += frag.maxId;
      parts.set(sku, { pd: `#${frag.pd + off}`, rep: `#${frag.rep + off}`, origin: `#${frag.origin + off}` });
      continue;
    }
    const pr = product(`${cp.sku} ${cp.name}`, cp.sku, 'part');
    const origin = w.ax2([0, 0, 0], [0, 0, 1], [1, 0, 0]);
    let rep: string;
    if (cp.procedural) {
      const solids = cp.procedural.solids.filter((s) => !s.decal).map((s) => writeExtrusion(w, s));
      rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${esc(cp.sku)}',(${[origin, ...solids].join(',')}),${ctx})`);
    } else if (cp.isCustom) {
      // user-uploaded mesh: no other geometry exists, export it faceted
      const tris = opts.meshFor?.(sku);
      const items = tris && tris.length ? [writeMesh(w, tris)] : [];
      rep = w.add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('${esc(cp.sku)}',(${[origin, ...items].join(',')}),${ctx})`);
    } else {
      // exact geometry unavailable (offline / not in the CAD repo): a bounding-box stand-in at the right place
      const [lo, hi] = cp.bounds ?? [
        (cp.dimensions ?? [10, 10, 10]).map((d) => -d / 2) as Vec3,
        (cp.dimensions ?? [10, 10, 10]).map((d) => d / 2) as Vec3,
      ];
      const box: Extrusion = {
        outline: { kind: 'poly', pts: [[lo[0], -hi[2]], [hi[0], -hi[2]], [hi[0], -lo[2]], [lo[0], -lo[2]]] },
        frame: { o: [0, lo[1], 0], u: [1, 0, 0], v: [0, 0, -1] },
        depth: Math.max(0.01, hi[1] - lo[1]),
        color: '#888',
      };
      rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${esc(cp.sku)} (bounding box)',(${[origin, writeExtrusion(w, box)].join(',')}),${ctx})`);
    }
    w.add(`SHAPE_DEFINITION_REPRESENTATION(${pr.pds},${rep})`);
    parts.set(sku, { pd: pr.pd, rep, origin });
  }

  visible.forEach((inst, k) => {
    const p = parts.get(inst.sku);
    if (!p) return;
    const m = new Matrix4().compose(new Vector3(...inst.position), new Quaternion(...inst.quaternion), new Vector3(1, 1, 1));
    if (opts.zUp !== false) m.premultiply(ZUP);
    const e = m.elements;
    const loc: Vec3 = [e[12], e[13], e[14]];
    const xAxis: Vec3 = [e[0], e[1], e[2]];
    const zAxis: Vec3 = [e[8], e[9], e[10]];
    const place = w.ax2(loc, zAxis, xAxis);
    rootItems.push(place);
    const label = `${inst.sku}:${k + 1}`;
    const nauo = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${esc(inst.instanceId)}','${esc(label)}','',${root.pd},${p.pd},$)`);
    const pds = w.add(`PRODUCT_DEFINITION_SHAPE('Placement','Placement of an item',${nauo})`);
    const idt = w.add(`ITEM_DEFINED_TRANSFORMATION('','',${p.origin},${place})`);
    const rel = w.add(
      `(REPRESENTATION_RELATIONSHIP('','',${p.rep},${rootRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`,
    );
    w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rel},${pds})`);
  });
  w.lines[rootRepIdx] = w.lines[rootRepIdx].replace('__ROOT_ITEMS__', rootItems.join(','));

  const now = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Ignite3D FTC robot assembly'),'2;1');`,
    `FILE_NAME('${name}.step','${now}',('Ignite3D'),('Spark Servos'),'Ignite3D','Ignite3D','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
    'ENDSEC;',
    'DATA;',
    ...w.lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

// silence unused helper import in some builds
void outlinePts;
