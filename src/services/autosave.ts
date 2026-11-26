// Autosave: every change is written to IndexedDB (large quota, own database) AND localStorage (sync, survives
// IndexedDB being blocked). On load the newest copy wins. A non-empty build that gets replaced by an empty or
// much smaller one is kept as a backup, so "Clear" or an accident can be undone after a reload too.
import { createStore, get, set } from 'idb-keyval';
import type { PlacedInstance } from '../types/cad';
import { toBuildFile } from '../lib/share';

const LS_KEY = 'ignite3d-autosave';
const LS_BACKUP = 'ignite3d-autosave-backup';
const IDB_KEY = 'autosave';
const IDB_BACKUP = 'autosave-backup';

export interface SavedBuild {
  instances: PlacedInstance[];
  savedAt: number;
}

let db: ReturnType<typeof createStore> | null | undefined;
function store() {
  if (db === undefined) {
    try {
      db = typeof indexedDB === 'undefined' ? null : createStore('ignite3d-builds', 'builds');
    } catch {
      db = null;
    }
  }
  return db;
}

function parse(raw: unknown): SavedBuild | null {
  const d = (typeof raw === 'string' ? safeJson(raw) : raw) as { instances?: PlacedInstance[]; savedAt?: number } | null;
  if (!d || !Array.isArray(d.instances)) return null;
  const instances = d.instances.filter((i) => typeof i?.sku === 'string' && Array.isArray(i.position) && Array.isArray(i.quaternion));
  return { instances, savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0 };
}
function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

let last: SavedBuild | null = null;

/** A different project was opened: its size is not a sign of lost work, so don't keep the old build as a backup. */
export function resetAutosaveBaseline() {
  last = null;
}

/** Write the build everywhere we can. Returns true if at least one store accepted it. */
export async function saveBuild(instances: PlacedInstance[]): Promise<boolean> {
  const payload = { ...toBuildFile(instances), savedAt: Date.now() };
  const prev = last;
  // keep the previous build when this save would throw most of it away
  const backup = prev && prev.instances.length >= 3 && instances.length < prev.instances.length / 2 ? prev : null;
  let ok = false;
  const json = JSON.stringify(payload);
  try {
    localStorage.setItem(LS_KEY, json);
    if (backup) localStorage.setItem(LS_BACKUP, JSON.stringify({ ...toBuildFile(backup.instances), savedAt: backup.savedAt }));
    ok = true;
  } catch {
    /* quota (localStorage is shared by every app on this domain) or blocked */
  }
  const s = store();
  if (s)
    try {
      await set(IDB_KEY, payload, s);
      if (backup) await set(IDB_BACKUP, { ...toBuildFile(backup.instances), savedAt: backup.savedAt }, s);
      ok = true;
    } catch {
      /* private mode / quota */
    }
  last = { instances, savedAt: payload.savedAt };
  return ok;
}

/** Synchronous best guess (localStorage) for the first paint. */
export function loadBuildSync(): SavedBuild | null {
  try {
    return parse(localStorage.getItem(LS_KEY));
  } catch {
    return null;
  }
}

/** The newest saved build across localStorage and IndexedDB. */
export async function loadBuild(): Promise<SavedBuild | null> {
  const a = loadBuildSync();
  let b: SavedBuild | null = null;
  const s = store();
  if (s)
    try {
      b = parse(await get(IDB_KEY, s));
    } catch {
      /* ignore */
    }
  const best = [a, b].filter((x): x is SavedBuild => !!x).sort((x, y) => y.savedAt - x.savedAt)[0] ?? null;
  last = best;
  return best;
}

export async function loadBackup(): Promise<SavedBuild | null> {
  let a: SavedBuild | null = null;
  try {
    a = parse(localStorage.getItem(LS_BACKUP));
  } catch {
    /* ignore */
  }
  let b: SavedBuild | null = null;
  const s = store();
  if (s)
    try {
      b = parse(await get(IDB_BACKUP, s));
    } catch {
      /* ignore */
    }
  return [a, b].filter((x): x is SavedBuild => !!x && x.instances.length > 0).sort((x, y) => y.savedAt - x.savedAt)[0] ?? null;
}
