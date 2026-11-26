// Lazy asset pipeline: catalog.json once at boot, .glb meshes only when a part is used.
// Order for meshes: memory -> IndexedDB (part-mesh-{sku}) -> jsDelivr CDN -> local ./parts/
// -> procedural fallback (always available instantly, upgraded in place when a .glb arrives).
import { Box3, BufferAttribute, BufferGeometry, Color, Material, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { CatalogPart, SnapPoint } from '../types/cad';
import { type AssetConfig, type RepoRef, DEFAULT_CAD_REPO, cdnBase, dracoBase, localBase } from '../config/assets';
import { cacheDel, cacheGet, cacheKeys, cacheSet } from './cache';
import { triangulateRecipe } from '../geometry/recipe';
import { chainKind, isChainSku, linkGeometry } from '../lib/chain';
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
    // plain GET with HTTP revalidation: a custom If-None-Match header triggers a CORS preflight jsDelivr rejects
    const res = await fetchWithTimeout(url, cfg.fetchTimeoutMs, { cache: 'no-cache' });
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
  if (isChainSku(part.sku)) {
    // library picture: a short straight run of links
    const g = linkGeometry();
    const n = 9;
    const pos = g.attributes.position;
    const arr = new Float32Array(pos.count * 3 * n);
    for (let k = 0; k < n; k++)
      for (let i = 0; i < pos.count; i++) {
        arr[(k * pos.count + i) * 3] = pos.getX(i) + (k - n / 2) * 8;
        arr[(k * pos.count + i) * 3 + 1] = pos.getZ(i);
        arr[(k * pos.count + i) * 3 + 2] = pos.getY(i);
      }
    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(arr, 3));
    cg.computeVertexNormals();
    cg.computeBoundingBox();
    cg.computeBoundingSphere();
    bounds.copy(cg.boundingBox!);
    meshes.push({ geometry: cg, material: cadMaterial(chainKind(part.sku).color) });
  } else if (part.procedural) {
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
    const box = part.bounds
      ? new Box3(new Vector3(...part.bounds[0]), new Vector3(...part.bounds[1]))
      : new Box3(new Vector3(-x / 2, -y / 2, -z / 2), new Vector3(x / 2, y / 2, z / 2));
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
    draco.setDecoderPath(dracoBase(cfg));
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
/** Bump when shipped meshes change (v2: coloured motors) so browsers drop their cached copies. */
const MESH_REV = 3;
const meshCacheKey = (part: CatalogPart) => (part.isCustom ? `part-mesh-${part.sku}` : `part-mesh-v${MESH_REV}-${part.sku}`);

/** Remove cached meshes of shipped parts from older mesh revisions (custom parts are never touched). */
export async function pruneMeshCache(shipped: Set<string>) {
  for (const k of await cacheKeys()) {
    const m = /^part-mesh-(?:v(\d+)-)?(.+)$/.exec(k);
    if (m && shipped.has(m[2]) && Number(m[1] ?? 1) < MESH_REV) await cacheDel(k);
  }
}

export function fetchGlbVisual(part: CatalogPart, cfg: AssetConfig, repo: RepoRef = cfg.primary): Promise<PartVisual | null> {
  const sku = part.sku;
  const existing = inflight.get(sku);
  if (existing) return existing;
  const p = (async () => {
    const key = meshCacheKey(part);
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
    // parts shipped with this site: same-origin first (always matches the deployed version), CDN as fallback
    urls.push([`${localBase()}parts/${sku}.glb`, 'local']);
    if (cfg.useCdn) urls.push([`${cdnBase(repo)}parts/${sku}.glb`, 'remote']);
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

// ------------------------------------------------------------------ exact STEP geometry for export

export interface StepIndexEntry {
  maxId: number;
  pd: number;
  rep: number;
  origin: number;
}

async function gunzipText(buf: ArrayBuffer): Promise<string> {
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(b);
}

const stepIndexCache = new Map<string, Record<string, StepIndexEntry> | null>();
async function stepIndex(base: string, cfg: AssetConfig) {
  if (stepIndexCache.has(base)) return stepIndexCache.get(base)!;
  let idx: Record<string, StepIndexEntry> | null = null;
  try {
    const res = await fetchWithTimeout(`${base}parts/step-index.json`, cfg.fetchTimeoutMs);
    if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) idx = await res.json();
  } catch {
    /* none */
  }
  stepIndexCache.set(base, idx);
  return idx;
}

/** Fetch the manufacturer STEP fragments (gzipped) for the given SKUs; missing ones are skipped. */
export async function fetchStepFragments(skus: string[], cfg: AssetConfig, onProgress?: (done: number, total: number) => void) {
  const bases = [
    ...(cfg.useCdn ? [cfg.cadBaseUrl ?? 'https://fanaustinca.github.io/ignite3d-cad/', cdnBase(cfg.cadRepo ?? DEFAULT_CAD_REPO), cdnBase(cfg.primary)] : []),
    localBase(),
  ];
  const out: Record<string, { maxId: number; pd: number; rep: number; origin: number; data: string }> = {};
  let done = 0;
  await Promise.all(
    skus.map(async (sku) => {
      const key = `step-frag-${sku}`;
      const cached = await cacheGet<{ meta: StepIndexEntry; data: string }>(key);
      if (cached) {
        out[sku] = { ...cached.meta, data: cached.data };
      } else
        for (const base of bases) {
          const idx = await stepIndex(base, cfg);
          const meta = idx?.[sku];
          if (!meta) continue;
          try {
            const res = await fetchWithTimeout(`${base}parts/${sku}.stp.gz`, 60000);
            if (!res.ok) continue;
            const data = await gunzipText(await res.arrayBuffer());
            if (!data.includes('PRODUCT_DEFINITION')) continue;
            out[sku] = { ...meta, data };
            await cacheSet(key, { meta, data });
            break;
          } catch {
            /* next source */
          }
        }
      onProgress?.(++done, skus.length);
    }),
  );
  return out;
}

// ------------------------------------------------------------------ real snap points (lazy)

const snapInflight = new Map<string, Promise<SnapPoint[] | null>>();
/** Load parts/{sku}.json (snap points measured from the real goBILDA STEP). */
export function fetchPartSnaps(part: CatalogPart, cfg: AssetConfig): Promise<SnapPoint[] | null> {
  const sku = part.sku;
  const running = snapInflight.get(sku);
  if (running) return running;
  const p = (async () => {
    const key = `part-snaps-v${BUILTIN_CATALOG_VERSION}-${sku}-${part.snapCount ?? 0}`;
    const cached = await cacheGet<SnapPoint[]>(key);
    if (cached) return cached;
    const bases = [localBase(), ...(cfg.useCdn ? [cdnBase(cfg.primary)] : [])];
    for (const base of bases) {
      const idx = await availableGlbs(base, cfg);
      if (idx && !idx.has(sku)) continue;
      try {
        const res = await fetchWithTimeout(`${base}parts/${sku}.json`, cfg.fetchTimeoutMs);
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) continue;
        const j = (await res.json()) as { snapPoints?: SnapPoint[] };
        if (!Array.isArray(j.snapPoints)) continue;
        await cacheSet(key, j.snapPoints);
        return j.snapPoints;
      } catch {
        /* next */
      }
    }
    return null;
  })().finally(() => snapInflight.delete(sku));
  snapInflight.set(sku, p);
  return p;
}
