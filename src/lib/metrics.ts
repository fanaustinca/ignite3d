import { Box3, Vector3 } from 'three';
import type { CatalogPart, PlacedInstance } from '../types/cad';
import { instanceMatrix } from './snap';
import { visualFor } from '../services/assetLoader';

export const SIZE_LIMIT_MM = 457.2; // 18 inches

export function partLocalBounds(part: CatalogPart): Box3 {
  return visualFor(part).bounds;
}

export function instanceWorldBox(inst: PlacedInstance, part: CatalogPart) {
  const b = partLocalBounds(part);
  const m = instanceMatrix(inst);
  const out = new Box3();
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.expandByPoint(new Vector3(x, y, z).applyMatrix4(m));
  return out;
}

export function robotBounds(instances: PlacedInstance[], catalog: Record<string, CatalogPart>) {
  const box = new Box3();
  for (const i of instances) {
    if (i.hidden || !catalog[i.sku]) continue;
    box.union(instanceWorldBox(i, catalog[i.sku]));
  }
  return box;
}

export interface MassProps {
  grams: number;
  lbs: number;
  priceUsd: number;
  count: number;
  cog: Vector3 | null;
}

export function massProps(instances: PlacedInstance[], catalog: Record<string, CatalogPart>): MassProps {
  let g = 0;
  let price = 0;
  let count = 0;
  const c = new Vector3();
  for (const i of instances) {
    if (i.hidden) continue;
    const p = catalog[i.sku];
    if (!p) continue;
    count++;
    g += p.massGrams;
    price += p.priceUsd;
    const center = partLocalBounds(p).getCenter(new Vector3()).applyMatrix4(instanceMatrix(i));
    c.addScaledVector(center, p.massGrams);
  }
  return { grams: g, lbs: g / 453.59237, priceUsd: price, count, cog: g > 0 ? c.multiplyScalar(1 / g) : null };
}

export function sizeCheck(box: Box3) {
  if (box.isEmpty()) return { size: new Vector3(), over: false, axes: [] as string[] };
  const size = box.getSize(new Vector3());
  const axes: string[] = [];
  if (size.x > SIZE_LIMIT_MM + 1e-6) axes.push('X');
  if (size.y > SIZE_LIMIT_MM + 1e-6) axes.push('Y (height)');
  if (size.z > SIZE_LIMIT_MM + 1e-6) axes.push('Z');
  return { size, over: axes.length > 0, axes };
}
