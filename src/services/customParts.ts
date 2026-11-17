// Custom (user-uploaded) parts persisted in IndexedDB: catalog entries + their .glb meshes.
import type { CatalogPart } from '../types/cad';
import { cacheDel, cacheGet, cacheSet } from './cache';

const LIST = 'custom-parts';

export async function listCustomParts(): Promise<CatalogPart[]> {
  return (await cacheGet<CatalogPart[]>(LIST)) ?? [];
}

export async function saveCustomPart(part: CatalogPart, glb: ArrayBuffer) {
  const list = (await listCustomParts()).filter((p) => p.sku !== part.sku);
  list.push({ ...part, isCustom: true, category: 'Custom' });
  await cacheSet(`part-mesh-${part.sku}`, glb);
  await cacheSet(LIST, list);
}

export async function deleteCustomPart(sku: string) {
  await cacheSet(LIST, (await listCustomParts()).filter((p) => p.sku !== sku));
  await cacheDel(`part-mesh-${sku}`);
}

export async function customPartMesh(sku: string) {
  return cacheGet<ArrayBuffer>(`part-mesh-${sku}`);
}
