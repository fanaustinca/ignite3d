// Robot Check: collision detection (live, incremental) + structure & stability report.
import { create } from 'zustand';
import type { CatalogPart, PlacedInstance } from '../types/cad';
import { useCadStore } from '../store/useCadStore';
import { fetchGlbVisual, peekVisual, visualFor, visualTriangles, type PartVisual } from './assetLoader';
import { ensureAllSnaps } from './visuals';
import { findCollisions, type Collision } from '../lib/analysis/collide';
import { analyzeStructure, type StrengthReport } from '../lib/analysis/strength';

export interface CheckState {
  open: boolean;
  live: boolean;
  running: boolean;
  progress: number;
  collisions: Collision[];
  /** Collisions are from the current build (live check ran after the last edit). */
  collisionsFresh: boolean;
  report: StrengthReport | null;
  reportStale: boolean;
  /** Issue / collision the user is pointing at (ids highlighted in the viewport). */
  focus: string[] | null;
  set: (p: Partial<CheckState>) => void;
}

const LIVE_KEY = 'ignite3d-live-collisions';
const liveDefault = (() => {
  try {
    return localStorage.getItem(LIVE_KEY) !== '0';
  } catch {
    return true;
  }
})();

export const useCheckStore = create<CheckState>()((set) => ({
  open: false,
  live: liveDefault,
  running: false,
  progress: 0,
  collisions: [],
  collisionsFresh: true,
  report: null,
  reportStale: true,
  focus: null,
  set: (p) => {
    if (p.live !== undefined)
      try {
        localStorage.setItem(LIVE_KEY, p.live ? '1' : '0');
      } catch {
        /* ignore */
      }
    set(p);
  },
}));

// ---------------------------------------------------------------- meshes

const tris = new WeakMap<PartVisual, Float32Array>();
/** Best mesh available right now: the real goBILDA mesh when loaded, else the procedural model. */
export function meshOf(part: CatalogPart) {
  const v = peekVisual(part.sku) ?? visualFor(part);
  let t = tris.get(v);
  if (!t) {
    t = visualTriangles(v);
    tris.set(v, t);
  }
  return { triangles: t };
}

const meshTried = new Set<string>();
/** Load real meshes + snaps for every SKU in the build (each SKU is tried once; procedural fallback otherwise). */
export async function ensureMeshes(skus: string[]) {
  const st = useCadStore.getState();
  const uniq = [...new Set(skus)];
  await ensureAllSnaps(uniq);
  const todo = uniq.filter((s) => {
    const v = peekVisual(s);
    return st.catalog[s] && !st.catalog[s].isCustom && (!v || v.source === 'procedural') && !meshTried.has(s);
  });
  for (const s of todo) meshTried.add(s);
  let i = 0;
  let loaded = 0;
  const worker = async () => {
    while (i < todo.length) {
      const sku = todo[i++];
      const v = await fetchGlbVisual(useCadStore.getState().catalog[sku], st.assetConfig);
      if (v) {
        loaded++;
        useCadStore.getState().setAssetStatus(sku, v.source);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (loaded) useCadStore.getState().bumpVisuals();
}

// ---------------------------------------------------------------- full check

let runId = 0;
export async function runRobotCheck() {
  const id = ++runId;
  const cs = useCheckStore.getState();
  cs.set({ running: true, progress: 0 });
  try {
    const st0 = useCadStore.getState();
    await ensureMeshes(st0.instances.map((i) => i.sku));
    const st = useCadStore.getState();
    const instances = st.instances;
    const col = await findCollisions(instances, st.catalog, meshOf, {
      onProgress: (d, t) => id === runId && useCheckStore.getState().set({ progress: t ? d / t : 1 }),
    });
    if (id !== runId) return;
    const report = analyzeStructure(instances, st.catalog, meshOf);
    const fresh = useCadStore.getState().instances === instances;
    useCheckStore.getState().set({ collisions: col.collisions, collisionsFresh: fresh, report, reportStale: !fresh, running: false, progress: 1 });
    lastChecked = new Map(instances.map((i) => [i.instanceId, poseOf(i)]));
    return { collisions: col.collisions, report, ms: col.ms, pairs: col.pairsChecked };
  } finally {
    if (id === runId) useCheckStore.getState().set({ running: false });
  }
}

// ---------------------------------------------------------------- live collision check

const poseOf = (i: PlacedInstance) => `${i.sku}|${i.hidden}|${i.position.join(',')}|${i.quaternion.join(',')}`;
let lastChecked = new Map<string, string>();
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let liveBusy = false;
let liveAgain = false;
const announced = new Set<string>();
const pairKey = (c: Collision) => [c.a, c.b].sort().join('|');

async function liveCheck() {
  if (liveBusy) {
    liveAgain = true;
    return;
  }
  liveBusy = true;
  try {
    const st = useCadStore.getState();
    const instances = st.instances;
    const ids = new Set(instances.map((i) => i.instanceId));
    const changed = new Set<string>();
    for (const i of instances) if (lastChecked.get(i.instanceId) !== poseOf(i)) changed.add(i.instanceId);
    const cs = useCheckStore.getState();
    let kept = cs.collisions.filter((c) => ids.has(c.a) && ids.has(c.b) && !changed.has(c.a) && !changed.has(c.b));
    if (changed.size && instances.length) {
      await ensureMeshes(instances.filter((i) => changed.has(i.instanceId)).map((i) => i.sku));
      const st2 = useCadStore.getState();
      if (st2.instances !== instances) {
        liveAgain = true;
        return;
      }
      const res = await findCollisions(instances, st2.catalog, meshOf, { only: changed });
      if (useCadStore.getState().instances !== instances) {
        liveAgain = true;
        return;
      }
      kept = kept.concat(res.collisions);
      const fresh = res.collisions.filter((c) => !announced.has(pairKey(c)));
      // one toast per new collision caused by a placement / move (not for whole loaded builds)
      if (fresh.length && fresh.length <= 3 && changed.size <= 8) {
        const c = fresh[0];
        const n = (sku: string) => st2.catalog[sku]?.name ?? sku;
        st2.toast(`Collision: ${n(c.skuA)} hits ${n(c.skuB)} (${c.depth.toFixed(1)} mm)`, 'warn');
      }
      for (const c of res.collisions) announced.add(pairKey(c));
    }
    lastChecked = new Map(instances.map((i) => [i.instanceId, poseOf(i)]));
    kept.sort((x, y) => y.depth * y.samples - x.depth * x.samples);
    useCheckStore.getState().set({ collisions: kept, collisionsFresh: true });
  } finally {
    liveBusy = false;
    if (liveAgain) {
      liveAgain = false;
      schedule(200);
    }
  }
}

function schedule(ms: number) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    const cs = useCheckStore.getState();
    if (cs.live) void liveCheck();
    if (cs.open && cs.reportStale) refreshReport();
  }, ms);
}

/** Structure report is cheap: recompute whenever the panel is open and the build changed. */
function refreshReport() {
  const st = useCadStore.getState();
  useCheckStore.getState().set({ report: analyzeStructure(st.instances, st.catalog, meshOf), reportStale: false });
}

let started = false;
export function startRobotCheck() {
  if (started) return;
  started = true;
  useCadStore.subscribe((s, p) => {
    if (s.instances === p.instances && s.visualVersion === p.visualVersion && s.catalog === p.catalog) return;
    if (s.instances !== p.instances) {
      useCheckStore.getState().set({ collisionsFresh: false, reportStale: true });
      if (!s.instances.length) {
        lastChecked.clear();
        announced.clear();
        useCheckStore.getState().set({ collisions: [], collisionsFresh: true });
      }
    }
    if (s.visualVersion !== p.visualVersion) lastChecked.clear(); // real meshes arrived: re-test with them
    schedule(450);
  });
  useCheckStore.subscribe((s, p) => {
    if (s.live && !p.live) schedule(0);
    if (!s.live && p.live) useCheckStore.getState().set({ collisions: [], collisionsFresh: true });
    if (s.open && !p.open) {
      useCheckStore.getState().set({ reportStale: true });
      schedule(0);
    }
  });
  schedule(800);
}
