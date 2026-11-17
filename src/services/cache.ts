// IndexedDB cache (idb-keyval) with graceful fallback when storage is unavailable.
import { createStore, get, set, del, keys, clear } from 'idb-keyval';

let store: ReturnType<typeof createStore> | null = null;
function s() {
  if (!store) {
    try {
      store = createStore('ignite3d', 'assets');
    } catch {
      store = null;
    }
  }
  return store;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const st = s();
    return st ? await get<T>(key, st) : undefined;
  } catch {
    return undefined;
  }
}
export async function cacheSet(key: string, value: unknown) {
  try {
    const st = s();
    if (st) await set(key, value, st);
  } catch {
    /* quota or private mode */
  }
}
export async function cacheDel(key: string) {
  try {
    const st = s();
    if (st) await del(key, st);
  } catch {
    /* ignore */
  }
}
export async function cacheKeys(): Promise<string[]> {
  try {
    const st = s();
    return st ? ((await keys(st)) as string[]) : [];
  } catch {
    return [];
  }
}
export async function cacheClear() {
  try {
    const st = s();
    if (st) await clear(st);
  } catch {
    /* ignore */
  }
}
