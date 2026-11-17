// Lazy asset pipeline: catalog.json once at boot, .glb meshes only when a part is used.
// Order for meshes: memory -> IndexedDB (part-mesh-{sku}) -> jsDelivr CDN -> local ./parts/
// -> procedural fallback (always available instantly, upgraded in place when a .glb arrives).
import { Box3, BufferAttribute, BufferGeometry, Color, Material, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { CatalogPart } from '../types/cad';
import { type AssetConfig, type RepoRef, cdnBase, localBase } from '../config/assets';
import { cacheGet, cacheSet } from './cache';
import { triangulateRecipe } from '../geometry/recipe';
import { BUILTIN_CATALOG, BUILTIN_CATALOG_VERSION } from '../data/catalog';

export type AssetSource = 'procedural' | 'cached' | 'remote' | 'local' | 'custom' | 'loading';

export interface PartVisual {
  meshes: { geometry: BufferGeometry; material: Material }[];
  source: AssetSource;
  bounds: Box3;
}

export interface CatalogFile {
  version: number;
  generated?: string;
  parts: CatalogPart[];
}

// ------------------------------------------------------------------ fetch helpers

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

const NEG_KEY = 'ignite3d-missing-glb';
const NEG_TTL = 6 * 3600 * 1000;
function negCache(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(NEG_KEY) || '{}');
  } catch {
    return {};
  }
}
function markMissing(url: string) {
  try {
    const m = negCache();
    m[url] = Date.now();
    localStorage.setItem(NEG_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
function knownMissing(url: string) {
  const t = negCache()[url];
  return !!t && Date.now() - t < NEG_TTL;
}
export function clearMissingCache() {
  try {
    localStorage.removeItem(NEG_KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ catalog

/** Fetch a repo's catalog.json with ETag revalidation + IndexedDB cache. */
export async function fetchRepoCatalog(repo: RepoRef, cfg: AssetConfig): Promise<CatalogFile | null> {
  const url = `${cdnBase(repo)}catalog.json`;
  const key = `catalog-${url}`;
  const cached = await cacheGet<{ etag?: string; data: CatalogFile }>(key);
  try {
    const res = await fetchWithTimeout(url, cfg.fetchTimeoutMs, cached?.etag ? { headers: { 'If-None-Match': cached.etag } } : undefined);
    if (res.status === 304 && cached) return cached.data;
    if (res.ok) {
      const data = (await res.json()) as CatalogFile;
      if (Array.isArray(data?.parts)) {
        await cacheSet(key, { etag: res.headers.get('etag') ?? undefined, data });
        return data;
      }
    }
  } catch {
    /* offline / blocked */
  }
  return cached?.data ?? null;
}

/**
 * Merge order: built-in seed < primary repo catalog (only if newer) < team repos < custom parts.
 * Built-in procedural recipes are kept when a remote entry has none.
 */
export function mergeCatalogs(base: CatalogPart[], remote: CatalogFile | null, team: CatalogFile[], custom: CatalogPart[]) {
  const map = new Map(base.map((p) => [p.sku, p]));
  if (remote && remote.version > BUILTIN_CATALOG_VERSION)
    for (const p of remote.parts) {
      const old = map.get(p.sku);
      map.set(p.sku, { ...old, ...p, procedural: p.procedural ?? old?.procedural });
    }
  for (const t of team) for (const p of t.parts) map.set(p.sku, { ...p, category: p.category ?? 'Custom' });
  for (const p of custom) map.set(p.sku, { ...p, isCustom: true, category: 'Custom' });
  return [...map.values()];
}

export async function loadFullCatalog(cfg: AssetConfig, custom: CatalogPart[]) {
  const remote = cfg.useCdn ? await fetchRepoCatalog(cfg.primary, cfg) : null;
  const team = (await Promise.all(cfg.teamRepos.map((r) => fetchRepoCatalog(r, cfg)))).filter((x): x is CatalogFile => !!x);
  return { parts: mergeCatalogs(BUILTIN_CATALOG, remote, team, custom), remoteOk: !!remote, teamLoaded: team.length };
}

// ------------------------------------------------------------------ meshes

const materialCache = new Map<string, MeshStandardMaterial>();
export function cadMaterial(color: string) {
  let m = materialCache.get(color);
  if (!m) {
    const c = new Color(color);
    const metal = c.getHSL({ h: 0, s: 0, l: 0 }).s < 0.15 && c.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45;
    m = new MeshStandardMaterial({ color: c, metalness: metal ? 0.55 : 0.15, roughness: metal ? 0.38 : 0.6, flatShading: true });
    materialCache.set(color, m);
  }
  return m;
}

export function proceduralVisual(part: CatalogPart): PartVisual {
  const meshes: PartVisual['meshes'] = [];
  const bounds = new Box3();
  if (part.procedural) {
    for (const [color, arr] of triangulateRecipe(part.procedural)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      bounds.union(g.boundingBox!);
      meshes.push({ geometry: g, material: cadMaterial(color) });
    }
  } else {
    // Unknown part with no recipe: dimension box.
    const [x, y, z] = part.dimensions ?? [24, 24, 24];
    const box = new Box3(new Vector3(-x / 2, -y / 2, -z / 2), new Vector3(x / 2, y / 2, z / 2));
    const g = boxGeometry(box);
    bounds.copy(box);
    meshes.push({ geometry: g, material: cadMaterial('#8a8f98') });
  }
  return { meshes, source: 'procedural', bounds };
}

function boxGeometry(b: Box3) {
  const { min: n, max: x } = b;
  const v = [
    [n.x, n.y, n.z], [x.x, n.y, n.z], [x.x, x.y, n.z], [n.x, x.y, n.z],
    [n.x, n.y, x.z], [x.x, n.y, x.z], [x.x, x.y, x.z], [n.x, x.y, x.z],
  ];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  const arr: number[] = [];
  for (const t of f) for (const i of t) arr.push(...v[i]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
  g.computeVertexNormals();
  return g;
}

let gltfLoader: GLTFLoader | null = null;
function loader(cfg: AssetConfig) {
  if (!gltfLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(cfg.dracoPath);
    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
  }
  return gltfLoader;
}

/** Parse a .glb buffer into baked (world-transformed) geometries in millimetres. */
export async function parseGlb(buf: ArrayBuffer, cfg: AssetConfig, scale = 1): Promise<PartVisual> {
  const gltf = await loader(cfg).parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  const meshes: PartVisual['meshes'] = [];
  const bounds = new Box3();
  const s = new Matrix4().makeScale(scale, scale, scale);
  gltf.scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(new Matrix4().multiplyMatrices(s, m.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    bounds.union(g.boundingBox!);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    meshes.push({ geometry: g, material: mat });
  });
  if (!meshes.length) throw new Error('GLB contains no meshes');
  return { meshes, source: 'remote', bounds };
}

// parts/index.json lists which {sku}.glb files exist, so we never probe for missing ones.
const glbIndex = new Map<string, Set<string> | null>();
async function availableGlbs(base: string, cfg: AssetConfig): Promise<Set<string> | null> {
  if (glbIndex.has(base)) return glbIndex.get(base)!;
  let set: Set<string> | null = null;
  try {
    const res = await fetchWithTimeout(`${base}parts/index.json`, cfg.fetchTimeoutMs, { cache: 'no-cache' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) {
      const j = (await res.json()) as { skus?: string[] };
      set = new Set(j.skus ?? []);
    }
  } catch {
    /* unknown -> probe */
  }
  glbIndex.set(base, set);
  return set;
}
export function clearGlbIndex() {
  glbIndex.clear();
}

const memory = new Map<string, PartVisual>();
const inflight = new Map<string, Promise<PartVisual | null>>();

export function peekVisual(sku: string) {
  return memory.get(sku);
}
export function setVisual(sku: string, v: PartVisual) {
  memory.set(sku, v);
}
export function forgetVisual(sku: string) {
  memory.delete(sku);
}

/**
 * Try to upgrade a part to its real .glb. Resolves to the visual (or null if none exists).
 * Never throws; procedural stays in place on any failure.
 */
export function fetchGlbVisual(part: CatalogPart, cfg: AssetConfig, repo: RepoRef = cfg.primary): Promise<PartVisual | null> {
  const sku = part.sku;
  const existing = inflight.get(sku);
  if (existing) return existing;
  const p = (async () => {
    const key = `part-mesh-${sku}`;
    const cached = await cacheGet<ArrayBuffer>(key);
    if (cached) {
      try {
        const v = await parseGlb(cached, cfg, part.glbScale ?? 1);
        v.source = part.isCustom ? 'custom' : 'cached';
        memory.set(sku, v);
        return v;
      } catch {
        /* corrupt cache entry: fall through to network */
      }
    }
    if (part.isCustom) return null;
    const urls: [string, AssetSource][] = [];
    if (cfg.useCdn) urls.push([`${cdnBase(repo)}parts/${sku}.glb`, 'remote']);
    urls.push([`${localBase()}parts/${sku}.glb`, 'local']);
    for (const [url, src] of urls) {
      if (knownMissing(url)) continue;
      const base = url.slice(0, url.lastIndexOf('parts/'));
      const idx = await availableGlbs(base, cfg);
      if (idx && !idx.has(sku)) continue;
      try {
        const res = await fetchWithTimeout(url, cfg.fetchTimeoutMs);
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || type.includes('text/html')) {
          if (res.status === 404 || type.includes('text/html')) markMissing(url);
          continue;
        }
        const buf = await res.arrayBuffer();
        const v = await parseGlb(buf, cfg, part.glbScale ?? 1);
        v.source = src;
        await cacheSet(key, buf);
        memory.set(sku, v);
        return v;
      } catch {
        /* network error / parse error -> next source */
      }
    }
    return null;
  })().finally(() => inflight.delete(sku));
  inflight.set(sku, p);
  return p;
}

/** Synchronous visual for rendering right now (procedural unless a mesh is already loaded). */
export function visualFor(part: CatalogPart): PartVisual {
  let v = memory.get(part.sku);
  if (!v) {
    v = proceduralVisual(part);
    memory.set(part.sku, v);
  }
  return v;
}

/** Triangle soup of the current visual (used by STL/STEP export of custom parts). */
export function visualTriangles(v: PartVisual): Float32Array {
  const out: number[] = [];
  for (const { geometry } of v.meshes) {
    const pos = geometry.attributes.position;
    const idx = geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      const k = idx ? idx.getX(i) : i;
      out.push(pos.getX(k), pos.getY(k), pos.getZ(k));
    }
  }
  return new Float32Array(out);
}
