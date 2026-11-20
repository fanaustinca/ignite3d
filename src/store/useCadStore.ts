import { create } from 'zustand';
import { temporal } from 'zundo';
import { Vector3 } from 'three';
import type { CatalogPart, PlacedInstance, Quat, Vec3 } from '../types/cad';
import { BUILTIN_CATALOG, LOCKNUT_SKU, shcsSku } from '../data/catalog';
import { type AssetSource } from '../services/assetLoader';
import { type AssetConfig, loadAssetConfig } from '../config/assets';
import { q4, rotateAbout, toVec3, v3, worldSnaps, type WorldSnap } from '../lib/snap';
import { axisKey, planFasten, spreadPick, type FastenOptions, type FastenPlan } from '../lib/fasten';

export type Theme = 'dark' | 'light';
export type Tool = 'select' | 'fasten';
export type Modal = null | 'help' | 'settings' | 'bom' | 'export' | 'upload' | 'share';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'error';
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

interface CadState {
  // ---- design (undo-tracked) ----
  instances: PlacedInstance[];
  // ---- catalog / assets ----
  catalog: Record<string, CatalogPart>;
  catalogOrder: string[];
  assetStatus: Record<string, AssetSource>;
  assetConfig: AssetConfig;
  visualVersion: number;
  // ---- interaction ----
  selection: string[];
  hovered: string | null;
  placingSku: string | null;
  ghostRot: number; // steps of 45° about the mating axis
  ghostAnchor: number;
  snapEnabled: boolean;
  tool: Tool;
  gizmoMode: 'translate' | 'rotate';
  gridStep: number; // 0 = free
  angleStep: number; // degrees, 0 = free
  preview: Record<string, { position: Vec3; quaternion: Quat }> | null;
  // ---- overlays / ui ----
  showSizingCube: boolean;
  showCoG: boolean;
  theme: Theme;
  modal: Modal;
  toasts: Toast[];
  lastSnapInfo: string | null;
  /** Time of the last successful autosave (null = failed / not yet). */
  savedAt: number | null;
  /** A larger build that was replaced by a much smaller one (restorable from the empty-scene panel). */
  backupBuild: { instances: PlacedInstance[]; savedAt: number } | null;

  setCatalog: (parts: CatalogPart[]) => void;
  updatePart: (sku: string, patch: Partial<CatalogPart>) => void;
  setAssetStatus: (sku: string, s: AssetSource) => void;
  bumpVisuals: () => void;
  setAssetConfig: (c: AssetConfig) => void;

  startPlacing: (sku: string | null) => void;
  addInstance: (i: Omit<PlacedInstance, 'instanceId' | 'hidden' | 'ghosted'> & Partial<PlacedInstance>) => string;
  addInstances: (list: PlacedInstance[]) => void;
  setInstances: (list: PlacedInstance[]) => void;
  updateTransforms: (map: Record<string, { position: Vec3; quaternion: Quat }>) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  select: (ids: string[], additive?: boolean) => void;
  selectAll: () => void;
  toggleHidden: () => void;
  unhideAll: () => void;
  toggleGhost: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  mirrorSelected: (axis: 'x' | 'z') => void;
  nudgeSelected: (mm: number) => void;
  rotateSelected: (deg: number) => void;
  fastenAt: (instanceId: string, snapId: string) => FastenPlan | null;
  fastenJoint: () => number;
  clearScene: () => void;

  set: (p: Partial<CadState>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
}

const idxCatalog = (parts: CatalogPart[]) => Object.fromEntries(parts.map((p) => [p.sku, p]));

/** The nyloc nut used by Smart Fasten: real goBILDA 2812 when present, else the procedural one. */
export function lockNutSku(catalog: Record<string, CatalogPart>) {
  return ['2812-0004-0007', '2810-0004-0001', LOCKNUT_SKU].find((s) => catalog[s]) ?? LOCKNUT_SKU;
}

function screwOrNut(sku: string) {
  return sku.startsWith('2800-') || sku.startsWith('2802-') || sku.startsWith('2812-') || sku.startsWith('2811-') || sku === LOCKNUT_SKU || sku === '2810-0004-0001';
}

export const useCadStore = create<CadState>()(
  temporal(
    (set, get) => ({
      instances: [],
      catalog: idxCatalog(BUILTIN_CATALOG),
      catalogOrder: BUILTIN_CATALOG.map((p) => p.sku),
      assetStatus: {},
      assetConfig: loadAssetConfig(),
      visualVersion: 0,
      selection: [],
      hovered: null,
      placingSku: null,
      ghostRot: 0,
      ghostAnchor: 0,
      snapEnabled: true,
      tool: 'select',
      gizmoMode: 'translate',
      gridStep: 8,
      angleStep: 45,
      preview: null,
      showSizingCube: false,
      showCoG: false,
      theme: (() => {
        try {
          const t = localStorage.getItem('ignite3d-theme');
          if (t === 'light' || t === 'dark') return t;
          return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        } catch {
          return 'dark';
        }
      })(),
      modal: null,
      toasts: [],
      lastSnapInfo: null,
      savedAt: null,
      backupBuild: null,

      setCatalog: (parts) =>
        set((st) => ({
          // keep snap points that were already lazy-loaded
          catalog: idxCatalog(parts.map((p) => (p.remoteSnaps && !p.snapPoints.length && st.catalog[p.sku]?.snapPoints.length ? { ...p, snapPoints: st.catalog[p.sku].snapPoints } : p))),
          catalogOrder: parts.map((p) => p.sku),
        })),
      updatePart: (sku, patch) => set((st) => (st.catalog[sku] ? { catalog: { ...st.catalog, [sku]: { ...st.catalog[sku], ...patch } } } : {})),
      setAssetStatus: (sku, s) => set((st) => ({ assetStatus: { ...st.assetStatus, [sku]: s } })),
      bumpVisuals: () => set((st) => ({ visualVersion: st.visualVersion + 1 })),
      setAssetConfig: (c) => set({ assetConfig: c }),

      startPlacing: (sku) => set({ placingSku: sku, ghostRot: 0, ghostAnchor: 0, tool: 'select', selection: sku ? [] : get().selection }),

      addInstance: (i) => {
        const inst: PlacedInstance = { hidden: false, ghosted: false, ...i, instanceId: i.instanceId ?? uid() };
        set((st) => ({ instances: [...st.instances, inst] }));
        return inst.instanceId;
      },
      addInstances: (list) => set((st) => ({ instances: [...st.instances, ...list] })),
      setInstances: (list) => set({ instances: list, selection: [] }),
      updateTransforms: (map) =>
        set((st) => ({
          instances: st.instances.map((i) => (map[i.instanceId] ? carrySnapFrame(i, map[i.instanceId]) : i)),
        })),
      removeSelected: () => {
        const sel = new Set(get().selection);
        if (!sel.size) return;
        set((st) => ({ instances: st.instances.filter((i) => !sel.has(i.instanceId)), selection: [] }));
      },
      duplicateSelected: () => {
        const sel = new Set(get().selection);
        if (!sel.size) return;
        const groupMap = new Map<string, string>();
        const copies = get()
          .instances.filter((i) => sel.has(i.instanceId))
          .map((i) => {
            let groupId = i.groupId;
            if (groupId) {
              if (!groupMap.has(groupId)) groupMap.set(groupId, uid());
              groupId = groupMap.get(groupId);
            }
            return { ...i, instanceId: uid(), groupId, position: [i.position[0] + 48, i.position[1], i.position[2]] as Vec3 };
          });
        set((st) => ({ instances: [...st.instances, ...copies], selection: copies.map((c) => c.instanceId) }));
      },
      select: (ids, additive) => {
        const st = get();
        // expand to whole groups
        const groups = new Set(st.instances.filter((i) => ids.includes(i.instanceId) && i.groupId).map((i) => i.groupId));
        const expanded = st.instances.filter((i) => ids.includes(i.instanceId) || (i.groupId && groups.has(i.groupId))).map((i) => i.instanceId);
        if (!additive) return set({ selection: expanded });
        const cur = new Set(st.selection);
        const allIn = expanded.every((id) => cur.has(id));
        expanded.forEach((id) => (allIn ? cur.delete(id) : cur.add(id)));
        set({ selection: [...cur] });
      },
      selectAll: () => set((st) => ({ selection: st.instances.filter((i) => !i.hidden).map((i) => i.instanceId) })),
      toggleHidden: () => {
        const sel = new Set(get().selection);
        if (!sel.size) return;
        set((st) => ({ instances: st.instances.map((i) => (sel.has(i.instanceId) ? { ...i, hidden: !i.hidden } : i)), selection: [] }));
      },
      unhideAll: () => set((st) => ({ instances: st.instances.map((i) => (i.hidden ? { ...i, hidden: false } : i)) })),
      toggleGhost: () => {
        const sel = new Set(get().selection);
        if (!sel.size) return;
        const anyOff = get().instances.some((i) => sel.has(i.instanceId) && !i.ghosted);
        set((st) => ({ instances: st.instances.map((i) => (sel.has(i.instanceId) ? { ...i, ghosted: anyOff } : i)) }));
      },
      groupSelected: () => {
        const sel = new Set(get().selection);
        if (sel.size < 2) return get().toast('Select 2+ parts to group', 'warn');
        const g = uid();
        set((st) => ({ instances: st.instances.map((i) => (sel.has(i.instanceId) ? { ...i, groupId: g } : i)) }));
        get().toast(`Grouped ${sel.size} parts`, 'ok');
      },
      ungroupSelected: () => {
        const sel = new Set(get().selection);
        set((st) => ({ instances: st.instances.map((i) => (sel.has(i.instanceId) ? { ...i, groupId: undefined } : i)) }));
      },
      mirrorSelected: (axis) => {
        const st = get();
        const sel = new Set(st.selection);
        if (!sel.size) return st.toast('Select parts to mirror', 'warn');
        const groupMap = new Map<string, string>();
        const copies = st.instances
          .filter((i) => sel.has(i.instanceId))
          .map((i) => {
            const [x, y, z] = i.position;
            const [qx, qy, qz, qw] = i.quaternion;
            const position: Vec3 = axis === 'x' ? [-x, y, z] : [x, y, -z];
            const quaternion: Quat = axis === 'x' ? [qx, -qy, -qz, qw] : [-qx, -qy, qz, qw];
            const mirrorSku = st.catalog[i.sku]?.mirrorSku;
            let groupId = i.groupId;
            if (groupId) {
              if (!groupMap.has(groupId)) groupMap.set(groupId, uid());
              groupId = groupMap.get(groupId);
            }
            return {
              ...i,
              instanceId: uid(),
              sku: mirrorSku && st.catalog[mirrorSku] ? mirrorSku : i.sku,
              position,
              quaternion,
              groupId,
              snapAxis: undefined,
              snapPivot: undefined,
            };
          });
        set({ instances: [...st.instances, ...copies], selection: copies.map((c) => c.instanceId) });
        st.toast(`Mirrored ${copies.length} part${copies.length > 1 ? 's' : ''} across the ${axis === 'x' ? 'YZ (left/right)' : 'XY (front/back)'} plane`, 'ok');
      },
      nudgeSelected: (mm) => {
        const st = get();
        const sel = st.instances.filter((i) => st.selection.includes(i.instanceId));
        if (!sel.length) return;
        const axis = v3(sel[0].snapAxis ?? [0, 1, 0]).normalize();
        const map: Record<string, { position: Vec3; quaternion: Quat }> = {};
        for (const i of sel) map[i.instanceId] = { position: toVec3(v3(i.position).addScaledVector(axis, mm)), quaternion: i.quaternion };
        st.updateTransforms(map);
        st.set({ lastSnapInfo: `Slid ${mm > 0 ? '+' : ''}${mm} mm along ${sel[0].snapAxis ? 'mated hole axis' : 'world Y'}` });
      },
      rotateSelected: (deg) => {
        const st = get();
        const sel = st.instances.filter((i) => st.selection.includes(i.instanceId));
        if (!sel.length) return;
        const axis = v3(sel[0].snapAxis ?? [0, 1, 0]);
        const pivot = sel[0].snapPivot
          ? v3(sel[0].snapPivot)
          : sel.reduce((a, i) => a.add(v3(i.position)), new Vector3()).multiplyScalar(1 / sel.length);
        const map: Record<string, { position: Vec3; quaternion: Quat }> = {};
        for (const i of sel) map[i.instanceId] = rotateAbout(i, axis, pivot, (deg * Math.PI) / 180);
        st.updateTransforms(map);
      },

      fastenAt: (instanceId, snapId) => {
        const st = get();
        const res = planFastenAt(st.instances, st.catalog, instanceId, snapId);
        if (!res.ok) {
          st.toast(res.reason, 'warn');
          return null;
        }
        const plan = res;
        const added = instancesForPlan(plan, st.catalog);
        st.addInstances(added);
        st.toast(
          `M4×${plan.screwLength} SHCS${plan.nut ? ' + locknut' : ' into threads'} · grip ${plan.grip.toFixed(1)} mm through ${plan.layers.length} layers${plan.warning ? ' — ' + plan.warning : ''}`,
          plan.warning ? 'warn' : 'ok',
        );
        return plan;
      },

      fastenJoint: () => {
        const st = get();
        const sel = new Set(st.selection);
        const res = planJointFasteners(st.instances, st.catalog, sel.size ? sel : null);
        if (res.reason) {
          st.toast(res.reason, 'warn');
          return 0;
        }
        st.addInstances(res.added);
        const screws = res.added.filter((a) => a.sku.startsWith('2800')).length;
        st.toast(`Fastened ${res.joints} joint${res.joints > 1 ? 's' : ''} with ${screws} screws (up to 4 per joint)`, 'ok');
        return screws;
      },

      clearScene: () => set({ instances: [], selection: [] }),
      set: (p) => set(p),
      toast: (text, kind = 'info') => {
        const id = Date.now() + Math.random();
        set((st) => ({ toasts: [...st.toasts.slice(-3), { id, text, kind }] }));
        setTimeout(() => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 4200);
      },
    }),
    {
      partialize: (s) => ({ instances: s.instances }),
      equality: (a, b) => a.instances === b.instances,
      limit: 300,
    },
  ),
);

/** Move an instance and carry its mated hole axis/pivot along, so R and [ ] keep working about the right axis. */
function carrySnapFrame(i: PlacedInstance, t: { position: Vec3; quaternion: Quat }): PlacedInstance {
  const out: PlacedInstance = { ...i, ...t };
  if (!i.snapAxis && !i.snapPivot) return out;
  const dq = q4(t.quaternion).multiply(q4(i.quaternion).invert());
  if (i.snapAxis) out.snapAxis = toVec3(v3(i.snapAxis).applyQuaternion(dq).normalize());
  if (i.snapPivot) out.snapPivot = toVec3(v3(i.snapPivot).sub(v3(i.position)).applyQuaternion(dq).add(v3(t.position)));
  return out;
}

/** Plan a screw at one hole face of a placed part (no side effects). Also rejects axes that already have a screw. */
export function planFastenAt(
  instances: PlacedInstance[],
  catalog: Record<string, CatalogPart>,
  instanceId: string,
  snapId: string,
): FastenPlan | { ok: false; reason: string } {
  const inst = instances.find((i) => i.instanceId === instanceId);
  const part = inst && catalog[inst.sku];
  if (!inst || !part) return { ok: false, reason: 'Part not found.' };
  const clicked = worldSnaps(inst, part).find((s) => s.snap.id === snapId);
  if (!clicked) return { ok: false, reason: 'Hole not found.' };
  const all = allWorldSnaps(instances.filter((i) => !isFastener(i.sku)), catalog, clicked.pos, 80);
  const plan = planFasten(clicked, all, fastenOptions(catalog));
  if (!plan.ok) return plan;
  if (!catalog[shcsSku(plan.screwLength)]) return { ok: false, reason: `M4×${plan.screwLength} screw is not in the catalogue.` };
  if (existingScrewAxes(instances, catalog).has(axisKey(plan.head, plan.dir))) return { ok: false, reason: 'That hole already has a screw.' };
  return plan;
}

/** Socket-head screws, nuts — hardware that Smart Fasten places by itself. */
export const isScrewSku = (sku: string) => /^280[02]-/.test(sku);
export const isFastener = (sku: string) => screwOrNut(sku);

export function allWorldSnaps(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, near?: Vector3, radius = Infinity) {
  const out: WorldSnap[] = [];
  for (const i of instances) {
    if (i.hidden) continue;
    const part = catalog[i.sku];
    if (!part) continue;
    if (near && v3(i.position).distanceTo(near) > radius + maxExtent(part)) continue;
    out.push(...worldSnaps(i, part));
  }
  return out;
}

const maxExtent = (p: CatalogPart) => {
  const d = p.dimensions ?? [100, 100, 100];
  return Math.hypot(d[0], d[1], d[2]);
};

function existingScrewAxes(instances: PlacedInstance[], _catalog: Record<string, CatalogPart>) {
  const keys = new Set<string>();
  for (const i of instances) {
    if (!i.sku.startsWith('2800-') && !i.sku.startsWith('2802-')) continue;
    const dir = new Vector3(0, -1, 0).applyQuaternion(q4(i.quaternion));
    keys.add(axisKey(v3(i.position), dir));
  }
  return keys;
}

function instancesForPlan(plan: FastenPlan, catalog: Record<string, CatalogPart>): PlacedInstance[] {
  const out: PlacedInstance[] = [];
  const sku = shcsSku(plan.screwLength);
  if (!catalog[sku]) return out;
  out.push({
    instanceId: uid(),
    sku,
    position: plan.screw.position,
    quaternion: plan.screw.quaternion,
    hidden: false,
    ghosted: false,
    snapAxis: toVec3(plan.dir),
    snapPivot: plan.screw.position,
  });
  if (plan.nut)
    out.push({
      instanceId: uid(),
      sku: lockNutSku(catalog),
      position: plan.nut.position,
      quaternion: plan.nut.quaternion,
      hidden: false,
      ghosted: false,
      snapAxis: toVec3(plan.dir),
    });
  return out;
}

export const undo = () => useCadStore.temporal.getState().undo();
export const redo = () => useCadStore.temporal.getState().redo();


/**
 * Find every pair of touching parts with coaxial M4 holes and plan up to `perJoint`
 * well-spread screws for each joint (skipping axes that already have a screw).
 */
export function planJointFasteners(instances: PlacedInstance[], catalog: Record<string, CatalogPart>, focus: Set<string> | null, perJoint = 4) {
  const pool = instances.filter((i) => !i.hidden && !screwOrNut(i.sku) && catalog[i.sku]);
  const focusList = focus ? pool.filter((i) => focus.has(i.instanceId)) : pool;
  if (!focusList.length) return { added: [] as PlacedInstance[], joints: 0, reason: 'Nothing to fasten — place some parts first.' };
  const allSnaps = pool.flatMap((i) => worldSnaps(i, catalog[i.sku]));
  const fastenable = (s: WorldSnap) => (s.snap.type === 'm4_hole' || s.snap.type === 'hub_pattern_16mm') && !s.snap.male;
  const hash = new Map<string, WorldSnap[]>();
  const hk = (p: Vector3) => `${Math.round(p.x * 4)},${Math.round(p.y * 4)},${Math.round(p.z * 4)}`;
  for (const s of allSnaps) {
    if (!fastenable(s)) continue;
    const k = hk(s.pos);
    const list = hash.get(k);
    if (list) list.push(s);
    else hash.set(k, [s]);
  }
  const focusIds = new Set(focusList.map((i) => i.instanceId));
  const existing = existingScrewAxes(instances, catalog);
  const fopts = fastenOptions(catalog);
  const byJoint = new Map<string, FastenPlan[]>();
  const existingInJoint = new Map<string, Vector3[]>();
  const seenAxes = new Set<string>();
  for (const s of allSnaps) {
    if (!fastenable(s) || !focusIds.has(s.instanceId)) continue;
    const mates = (hash.get(hk(s.pos)) ?? []).filter((o) => o.instanceId !== s.instanceId && o.normal.dot(s.normal) < -0.999 && o.pos.distanceTo(s.pos) < 0.3);
    if (!mates.length) continue;
    const plan = planFasten(s, allSnaps, fopts);
    if (!plan.ok) continue;
    const key = axisKey(plan.head, plan.dir);
    if (seenAxes.has(key)) continue;
    seenAxes.add(key);
    const jointKey = [...new Set(plan.layers.map((l) => l.instanceId))].sort().join('|');
    if (existing.has(key)) {
      // already screwed: counts toward this joint's quota and seeds the spread
      const seeds = existingInJoint.get(jointKey);
      if (seeds) seeds.push(plan.head);
      else existingInJoint.set(jointKey, [plan.head]);
      continue;
    }
    const list = byJoint.get(jointKey);
    if (list) list.push(plan);
    else byJoint.set(jointKey, [plan]);
  }
  const added: PlacedInstance[] = [];
  for (const [jk, plans] of byJoint) {
    const seeds = existingInJoint.get(jk) ?? [];
    for (const p of spreadPick(plans, (x) => x.head, perJoint - seeds.length, seeds)) added.push(...instancesForPlan(p, catalog));
  }
  const reason = added.length ? undefined : existing.size ? 'Every joint already has its screws.' : 'No aligned M4 holes between touching parts.';
  return { added, joints: [...byJoint.keys()].filter((k) => (existingInJoint.get(k)?.length ?? 0) < perJoint).length, reason };
}

/** Screw lengths and nut height available in the current catalogue (real goBILDA when loaded). */
export function fastenOptions(catalog: Record<string, CatalogPart>): FastenOptions {
  const lengths = Object.keys(catalog)
    .filter((k) => /^2800-0004-\d{4}$/.test(k))
    .map((k) => Number(k.slice(-4)))
    .filter((L) => L >= 6)
    .sort((a, b) => a - b);
  const nut = catalog[lockNutSku(catalog)];
  return { lengths: lengths.length ? lengths : undefined, nutHeight: nut?.dimensions ? nut.dimensions[1] : undefined };
}
