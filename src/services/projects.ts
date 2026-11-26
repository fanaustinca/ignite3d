// Projects: several robots saved side by side in this browser. Each project has its own build (IndexedDB, with a
// localStorage fallback) and may be linked to an online cloud file (6-digit code). The open project autosaves.
import { create } from 'zustand';
import { createStore, del, get, set } from 'idb-keyval';
import type { PlacedInstance } from '../types/cad';
import { useCadStore } from '../store/useCadStore';
import { fromBuildFile, toBuildFile } from '../lib/share';
import { resetAutosaveBaseline } from './autosave';
import { flushCloud, leaveCloud, openCloudFile, registerProjectHooks, useCloudStore } from './cloud';

export interface ProjectMeta {
  id: string;
  name: string;
  /** Linked cloud file, if any. */
  code: string | null;
  parts: number;
  updatedAt: number;
}
interface ProjectState {
  list: ProjectMeta[];
  activeId: string | null;
}

const LS_INDEX = 'ignite3d-projects';
const LS_ACTIVE = 'ignite3d-project-active';
const lsBuild = (id: string) => `ignite3d-project:${id}`;
const lsRead = <T,>(k: string, d: T): T => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};
const lsWrite = (k: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

let db: ReturnType<typeof createStore> | null | undefined;
function store() {
  if (db === undefined)
    try {
      db = typeof indexedDB === 'undefined' ? null : createStore('ignite3d-projects', 'builds');
    } catch {
      db = null;
    }
  return db;
}

export const useProjectStore = create<ProjectState>()(() => ({
  list: lsRead<ProjectMeta[]>(LS_INDEX, []),
  activeId: lsRead<string | null>(LS_ACTIVE, null),
}));
const setP = (p: Partial<ProjectState>) => {
  useProjectStore.setState(p);
  const s = useProjectStore.getState();
  lsWrite(LS_INDEX, s.list);
  lsWrite(LS_ACTIVE, s.activeId);
};
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const activeProject = () => {
  const s = useProjectStore.getState();
  return s.list.find((p) => p.id === s.activeId) ?? null;
};
function patch(id: string, p: Partial<ProjectMeta>) {
  setP({ list: useProjectStore.getState().list.map((m) => (m.id === id ? { ...m, ...p } : m)) });
}

/** Builds of projects touched this session (switching back and forth never waits on storage). */
const mem = new Map<string, PlacedInstance[]>();

async function writeBuild(id: string, instances: PlacedInstance[]) {
  mem.set(id, instances);
  const payload = toBuildFile(instances);
  // small builds are mirrored in localStorage first (synchronous, survives a blocked IndexedDB); IndexedDB holds all
  const small = JSON.stringify(payload).length < 400_000;
  let ok = small && lsWrite(lsBuild(id), payload);
  const s = store();
  if (s)
    try {
      await set(id, payload, s);
      ok = true;
    } catch {
      /* localStorage copy only */
    }
  if (!small && ok) lsWrite(lsBuild(id), null);
  return ok;
}
async function readBuild(id: string): Promise<PlacedInstance[]> {
  const m = mem.get(id);
  if (m) return m;
  const fromLs = fromBuildFile(lsRead(lsBuild(id), null));
  if (fromLs) return fromLs;
  const s = store();
  if (s)
    try {
      const d = await get(id, s);
      const l = d && fromBuildFile(d);
      if (l) return l;
    } catch {
      /* ignore */
    }
  return fromBuildFile(lsRead(lsBuild(id), null)) ?? [];
}

/** Called by the app's autosave on every change: the open project keeps its build. */
export async function saveActiveProject(instances: PlacedInstance[]) {
  const p = activeProject();
  if (p) await saveProjectBuild(p.id, instances);
}
/** Save a build into a specific project (the autosave records which project an edit belonged to). */
export async function saveProjectBuild(id: string, instances: PlacedInstance[]) {
  if (!useProjectStore.getState().list.some((m) => m.id === id)) return;
  await writeBuild(id, instances);
  patch(id, { parts: instances.length, updatedAt: Date.now() });
}

function load(instances: PlacedInstance[]) {
  const st = useCadStore.getState();
  resetAutosaveBaseline();
  st.set({ backupBuild: null });
  st.setInstances(instances);
  useCadStore.temporal.getState().clear();
}

/** Save what is on screen into the open project before leaving it. */
async function saveCurrent() {
  flushCloud();
  // memory + localStorage copies are written synchronously; the IndexedDB write finishes in the background
  void saveActiveProject(useCadStore.getState().instances);
}

export async function openProject(id: string) {
  const target = useProjectStore.getState().list.find((p) => p.id === id);
  if (!target || id === useProjectStore.getState().activeId) return;
  await saveCurrent();
  if (useCloudStore.getState().code) leaveCloud({ keepProject: true });
  setP({ activeId: id });
  load(await readBuild(id));
  if (target.code) await openCloudFile(target.code, { quiet: true, fromProject: true });
  useCadStore.getState().toast(`Opened project “${target.name}”`, 'ok');
}

export async function newProject(name = '') {
  await saveCurrent();
  if (useCloudStore.getState().code) leaveCloud({ keepProject: true });
  const list = useProjectStore.getState().list;
  const p: ProjectMeta = { id: newId(), name: name.trim() || uniqueName('New robot'), code: null, parts: 0, updatedAt: Date.now() };
  setP({ list: [p, ...list], activeId: p.id });
  load([]);
  await writeBuild(p.id, []);
  return p.id;
}

export async function duplicateProject(id: string) {
  const src = useProjectStore.getState().list.find((p) => p.id === id);
  if (!src) return;
  if (id === useProjectStore.getState().activeId) await saveCurrent();
  const build = await readBuild(id);
  const p: ProjectMeta = { id: newId(), name: uniqueName(`${src.name} copy`), code: null, parts: build.length, updatedAt: Date.now() };
  await writeBuild(p.id, build);
  const list = useProjectStore.getState().list;
  const i = list.findIndex((m) => m.id === id);
  setP({ list: [...list.slice(0, i + 1), p, ...list.slice(i + 1)] });
  return p.id;
}

export async function deleteProject(id: string) {
  const list = useProjectStore.getState().list;
  if (!list.some((p) => p.id === id)) return;
  if (id === useProjectStore.getState().activeId) {
    const next = list.find((p) => p.id !== id);
    if (next) await openProject(next.id);
    else await newProject();
  }
  setP({ list: useProjectStore.getState().list.filter((p) => p.id !== id) });
  const s = store();
  if (s) await del(id, s).catch(() => {});
  lsWrite(lsBuild(id), null);
}

export function renameProject(id: string, name: string) {
  const n = name.trim().slice(0, 80);
  if (!n) return;
  patch(id, { name: n });
  const p = useProjectStore.getState().list.find((m) => m.id === id);
  if (p && id === useProjectStore.getState().activeId && p.code && useCloudStore.getState().code === p.code) {
    void import('./cloud').then((c) => c.renameCloudFile(n));
  }
}

function uniqueName(base: string) {
  const names = new Set(useProjectStore.getState().list.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let k = 2; ; k++) if (!names.has(`${base} ${k}`)) return `${base} ${k}`;
}

/** First run: turn whatever is on screen into the first project. */
export function initProjects() {
  const s = useProjectStore.getState();
  if (!s.list.length) {
    const p: ProjectMeta = { id: newId(), name: 'My robot', code: useCloudStore.getState().code, parts: useCadStore.getState().instances.length, updatedAt: Date.now() };
    setP({ list: [p], activeId: p.id });
    void writeBuild(p.id, useCadStore.getState().instances);
  } else if (!s.list.some((p) => p.id === s.activeId)) setP({ activeId: s.list[0].id });

  // another tab changed the project list: pick it up so neither tab overwrites the other's projects
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_INDEX || !e.newValue) return;
    try {
      const incoming = JSON.parse(e.newValue) as ProjectMeta[];
      const mine = activeProject();
      // never drop the project this tab has open (e.g. the other tab started from an empty list)
      useProjectStore.setState({ list: mine && !incoming.some((p) => p.id === mine.id) ? [mine, ...incoming] : incoming });
    } catch {
      /* ignore */
    }
  });

  registerProjectHooks({
    // a cloud file is about to replace the build on screen: give it its own project (never overwrite another robot)
    async beforeOpen(code, name) {
      const cur = activeProject();
      if (cur?.code === code) return;
      await saveActiveProject(useCadStore.getState().instances);
      resetAutosaveBaseline();
      useCadStore.getState().set({ backupBuild: null });
      const existing = useProjectStore.getState().list.find((p) => p.code === code);
      if (existing) return setP({ activeId: existing.id });
      if (cur && !cur.code && cur.parts === 0 && !useCadStore.getState().instances.length) return patch(cur.id, { code, name });
      const p: ProjectMeta = { id: newId(), name, code, parts: 0, updatedAt: Date.now() };
      setP({ list: [p, ...useProjectStore.getState().list], activeId: p.id });
    },
    linked(code, name) {
      const cur = activeProject();
      if (cur) patch(cur.id, { code, name: name || cur.name });
    },
    renamed(code, name) {
      const p = useProjectStore.getState().list.find((m) => m.code === code);
      if (p && p.name !== name) patch(p.id, { name });
    },
    left(code) {
      const p = useProjectStore.getState().list.find((m) => m.code === code);
      if (p) patch(p.id, { code: null });
    },
  });
}
