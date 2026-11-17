// Local exports: STEP (Onshape), STL, GLB, JSON manifest, BOM CSV.
import { Group, Matrix4, Mesh, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CatalogPart, PlacedInstance } from '../types/cad';
import { instanceMatrix } from '../lib/snap';
import { visualFor, visualTriangles } from '../services/assetLoader';
import { exportStep } from './step';
import { toBuildFile } from '../lib/share';
import { APP_VERSION } from '../version';

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const ZUP = new Matrix4().makeRotationX(Math.PI / 2);
const visible = (insts: PlacedInstance[]) => insts.filter((i) => !i.hidden);

export function buildStep(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, name = 'Ignite3D Robot') {
  return exportStep(visible(instances), catalog, {
    name,
    meshFor: (sku) => (catalog[sku] ? visualTriangles(visualFor(catalog[sku])) : null),
  });
}

/** Binary STL of the whole robot, millimetres, Z-up. */
export function buildStl(instances: PlacedInstance[], catalog: Record<string, CatalogPart>): ArrayBuffer {
  const chunks: Float32Array[] = [];
  let tris = 0;
  for (const inst of visible(instances)) {
    const part = catalog[inst.sku];
    if (!part) continue;
    const t = visualTriangles(visualFor(part));
    const m = instanceMatrix(inst).premultiply(ZUP);
    const out = new Float32Array(t.length);
    const v = new Vector3();
    for (let i = 0; i < t.length; i += 3) {
      v.set(t[i], t[i + 1], t[i + 2]).applyMatrix4(m);
      out[i] = v.x;
      out[i + 1] = v.y;
      out[i + 2] = v.z;
    }
    chunks.push(out);
    tris += t.length / 9;
  }
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  const header = `Ignite3D ${APP_VERSION} STL (mm, Z-up)`;
  for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris, true);
  let o = 84;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  for (const ch of chunks)
    for (let i = 0; i < ch.length; i += 9) {
      a.set(ch[i], ch[i + 1], ch[i + 2]);
      b.set(ch[i + 3], ch[i + 4], ch[i + 5]);
      c.set(ch[i + 6], ch[i + 7], ch[i + 8]);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      for (const val of [n.x, n.y, n.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]) {
        dv.setFloat32(o, val, true);
        o += 4;
      }
      dv.setUint16(o, 0, true);
      o += 2;
    }
  return buf;
}

/** GLB of the robot (glTF convention: metres, Y-up), one node per placed part. */
export async function buildGlb(instances: PlacedInstance[], catalog: Record<string, CatalogPart>): Promise<ArrayBuffer> {
  const root = new Group();
  root.name = 'Ignite3D Robot';
  root.scale.setScalar(0.001);
  for (const inst of visible(instances)) {
    const part = catalog[inst.sku];
    if (!part) continue;
    const g = new Group();
    g.name = `${inst.sku} ${part.name}`;
    g.userData = { sku: inst.sku, instanceId: inst.instanceId };
    instanceMatrix(inst).decompose(g.position, g.quaternion, g.scale);
    for (const m of visualFor(part).meshes) g.add(new Mesh(m.geometry, m.material));
    root.add(g);
  }
  const exporter = new GLTFExporter();
  const res = await exporter.parseAsync(root, { binary: true });
  return res as ArrayBuffer;
}

/** Row-major 4×4 in metres, Z-up — the format Onshape's /occurrencetransforms endpoint takes. */
export function onshapeTransform(inst: PlacedInstance): number[] {
  const m = instanceMatrix(inst).premultiply(ZUP);
  const e = m.elements; // column-major
  const t = [e[0], e[4], e[8], e[12] / 1000, e[1], e[5], e[9], e[13] / 1000, e[2], e[6], e[10], e[14] / 1000, 0, 0, 0, 1];
  return t.map((x) => Math.round(x * 1e9) / 1e9);
}

export function buildManifest(instances: PlacedInstance[], catalog: Record<string, CatalogPart>) {
  const vis = visible(instances);
  return {
    ...toBuildFile(instances),
    units: { scene: 'mm, Y-up', onshapeTransform: 'row-major 4x4, metres, Z-up' },
    generated: new Date().toISOString(),
    occurrences: vis.map((i) => ({
      instanceId: i.instanceId,
      sku: i.sku,
      name: catalog[i.sku]?.name ?? i.sku,
      groupId: i.groupId ?? null,
      onshapeTransform: onshapeTransform(i),
    })),
    bom: bomRows(vis, catalog),
  };
}

export interface BomRow {
  sku: string;
  name: string;
  category: string;
  qty: number;
  unitMassG: number;
  totalMassG: number;
  unitPriceUsd: number;
  totalPriceUsd: number;
  custom: boolean;
}

export function bomRows(instances: PlacedInstance[], catalog: Record<string, CatalogPart>): BomRow[] {
  const counts = new Map<string, number>();
  for (const i of instances) if (!i.hidden) counts.set(i.sku, (counts.get(i.sku) ?? 0) + 1);
  const rows: BomRow[] = [];
  for (const [sku, qty] of counts) {
    const p = catalog[sku];
    if (!p) continue;
    rows.push({
      sku,
      name: p.name,
      category: p.category,
      qty,
      unitMassG: p.massGrams,
      totalMassG: Math.round(p.massGrams * qty * 10) / 10,
      unitPriceUsd: p.priceUsd,
      totalPriceUsd: Math.round(p.priceUsd * qty * 100) / 100,
      custom: !!p.isCustom,
    });
  }
  const order = ['Structure', 'Mounts', 'Motors & Servos', 'Shafts & Hubs', 'Gears & Slides', 'Wheels', 'Fasteners & Spacers', 'Custom'];
  return rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.sku.localeCompare(b.sku));
}

export function bomCsv(rows: BomRow[]) {
  const q = (s: string | number) => {
    const t = String(s);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['SKU', 'Name', 'Category', 'Qty', 'Unit Mass (g)', 'Total Mass (g)', 'Unit Price (USD)', 'Total Price (USD)'];
  const lines = [head.join(',')];
  for (const r of rows) lines.push([r.sku, r.name, r.category, r.qty, r.unitMassG, r.totalMassG, r.unitPriceUsd.toFixed(2), r.totalPriceUsd.toFixed(2)].map(q).join(','));
  const tq = rows.reduce((s, r) => s + r.qty, 0);
  const tm = rows.reduce((s, r) => s + r.totalMassG, 0);
  const tp = rows.reduce((s, r) => s + r.totalPriceUsd, 0);
  lines.push(['TOTAL', '', '', tq, '', tm.toFixed(1), '', tp.toFixed(2)].map(q).join(','));
  return lines.join('\n') + '\n';
}
