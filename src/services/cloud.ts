// Cloud save: CAD files stored in Firebase Firestore, one document per file, addressed by a 6-digit access code.
// Anyone with the code can open and edit; edits auto-save online and stream live to everyone who has it open.
// Codes are remembered in localStorage, so a code is typed once per browser; the last open file reopens on load.
import { create } from 'zustand';
import { compressToBase64, decompressFromBase64 } from 'lz-string';
import type { PlacedInstance } from '../types/cad';
import { useCadStore } from '../store/useCadStore';
import { fromBuildFile, toBuildFile } from '../lib/share';
import { CAD_COLLECTION, firebaseConfig } from '../config/firebase';
import { APP_VERSION } from '../version';

export interface CloudDoc {
  data: string;
  name: string;
  parts: number;
  rev: number;
  by: string;
  updatedAt: number;
  createdAt: number;
  app: string;
}

interface Backend {
  get(code: string): Promise<CloudDoc | null>;
  /** Create only if the code is still free; resolves false when it is taken. */
  create(code: string, doc: CloudDoc): Promise<boolean>;
  write(code: string, doc: CloudDoc): Promise<void>;
  watch(code: string, cb: (doc: CloudDoc | null) => void, onError: (e: unknown) => void): () => void;
}

// ---------------------------------------------------------------- backends

const MOCK_KEY = 'ignite3d-cloud-mock';
/** Test / offline-dev backend: localStorage + the `storage` event, so two tabs sync like two computers. */
function mockBackend(): Backend {
  const k = (code: string) => `ignite3d-mockcad:${code}`;
  const read = (code: string): CloudDoc | null => {
    try {
      const s = localStorage.getItem(k(code));
      return s ? (JSON.parse(s) as CloudDoc) : null;
    } catch {
      return null;
    }
  };
  return {
    async get(code) {
      return read(code);
    },
    async create(code, doc) {
      if (read(code)) return false;
      localStorage.setItem(k(code), JSON.stringify(doc));
      return true;
    },
    async write(code, doc) {
      localStorage.setItem(k(code), JSON.stringify(doc));
    },
    watch(code, cb) {
      const on = (e: StorageEvent) => e.key === k(code) && cb(read(code));
      window.addEventListener('storage', on);
      return () => window.removeEventListener('storage', on);
    },
  };
}

function firestoreBackend(): Backend {
  // the Firebase SDK is ~300 KB: only load it when a cloud file is actually used
  const sdk = (async () => {
    const [{ initializeApp, getApps }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
    const app = getApps()[0] ?? initializeApp(firebaseConfig);
    return { fs, db: fs.getFirestore(app) };
  })();
  const ref = async (code: string) => {
    const { fs, db } = await sdk;
    return { fs, db, r: fs.doc(db, CAD_COLLECTION, code) };
  };
  return {
    async get(code) {
      const { fs, r } = await ref(code);
      const s = await fs.getDoc(r);
      return s.exists() ? (s.data() as CloudDoc) : null;
    },
    async create(code, doc) {
      const { fs, db, r } = await ref(code);
      return fs.runTransaction(db, async (tx) => {
        if ((await tx.get(r)).exists()) return false;
        tx.set(r, doc);
        return true;
      });
    },
    async write(code, doc) {
      const { fs, r } = await ref(code);
      await fs.setDoc(r, doc);
    },
    watch(code, cb, onError) {
      let stop: (() => void) | null = null;
      let dead = false;
      ref(code).then(({ fs, r }) => {
        if (dead) return;
        stop = fs.onSnapshot(
          r,
          (s) => {
            if (s.metadata.hasPendingWrites) return; // our own write echoing back
            cb(s.exists() ? (s.data() as CloudDoc) : null);
          },
          onError,
        );
      }, onError);
      return () => {
        dead = true;
        stop?.();
      };
    },
  };
}

const mockOn = () => {
  try {
    return new URLSearchParams(location.search).has('cloudmock') || localStorage.getItem(MOCK_KEY) === '1';
  } catch {
    return false;
  }
};
export const cloudConfigured = () => mockOn() || !!(firebaseConfig.apiKey && firebaseConfig.projectId);
let backend: Backend | null = null;
const be = () => (backend ??= mockOn() ? mockBackend() : firestoreBackend());

// ---------------------------------------------------------------- encoding

export function encodeCad(instances: PlacedInstance[]) {
  return compressToBase64(JSON.stringify(toBuildFile(instances)));
}
export function decodeCad(data: string): PlacedInstance[] | null {
  try {
    return fromBuildFile(JSON.parse(decompressFromBase64(data) || 'null'));
  } catch {
    return null;
  }
}
export const isCode = (s: string) => /^\d{6}$/.test(s);
function newCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
}
const MAX_BYTES = 950_000; // Firestore documents are capped at 1 MiB

// ---------------------------------------------------------------- state

export type CloudStatus = 'off' | 'connecting' | 'saving' | 'saved' | 'error';
export interface Remembered {
  code: string;
  name: string;
  at: number;
}
export interface CloudState {
  code: string | null;
  name: string;
  status: CloudStatus;
  error: string | null;
  savedAt: number | null;
  /** Someone else changed the file and it was pulled in. */
  remoteAt: number | null;
  remembered: Remembered[];
  /** The local build that was on screen before a cloud file replaced it. */
  stash: PlacedInstance[] | null;
}

const LS_CODES = 'ignite3d-cloud-codes';
const LS_ACTIVE = 'ignite3d-cloud-active';
const LS_STASH = 'ignite3d-cloud-stash';
const lsGet = <T,>(k: string, d: T): T => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};
const lsSet = (k: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* quota / blocked */
  }
};

export const useCloudStore = create<CloudState>()(() => ({
  code: null,
  name: '',
  status: 'off',
  error: null,
  savedAt: null,
  remoteAt: null,
  remembered: lsGet<Remembered[]>(LS_CODES, []),
  stash: lsGet<PlacedInstance[] | null>(LS_STASH, null),
}));
const setC = (p: Partial<CloudState>) => useCloudStore.setState(p);

function remember(code: string, name: string) {
  const list = [{ code, name, at: Date.now() }, ...useCloudStore.getState().remembered.filter((r) => r.code !== code)].slice(0, 30);
  lsSet(LS_CODES, list);
  setC({ remembered: list });
}
export function forgetCode(code: string) {
  const list = useCloudStore.getState().remembered.filter((r) => r.code !== code);
  lsSet(LS_CODES, list);
  setC({ remembered: list });
  if (useCloudStore.getState().code === code) leaveCloud();
}

// ---------------------------------------------------------------- sync engine

const session = Math.random().toString(36).slice(2, 12);
let unwatch: (() => void) | null = null;
let unsubLocal: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let applying = false;
let rev = 0;
let lastData = '';
let createdAt = 0;
let binding = 0;

function applyRemote(list: PlacedInstance[]) {
  const st = useCadStore.getState();
  const ids = new Set(list.map((i) => i.instanceId));
  applying = true;
  const t = useCadStore.temporal.getState();
  t.pause();
  try {
    st.setInstances(list);
    // keep what this user had selected when it still exists
    const sel = st.selection.filter((id) => ids.has(id));
    if (sel.length) useCadStore.getState().select(sel);
  } finally {
    t.resume();
    applying = false;
  }
}

async function push() {
  clearTimeout(timer);
  const code = useCloudStore.getState().code;
  if (!code || !pending) return;
  pending = false;
  const instances = useCadStore.getState().instances;
  const data = encodeCad(instances);
  if (data === lastData) return setC({ status: 'saved' });
  if (data.length > MAX_BYTES) {
    setC({ status: 'error', error: 'This build is too big to save online (over 1 MB). It is still saved in this browser.' });
    return;
  }
  setC({ status: 'saving' });
  const doc: CloudDoc = { data, name: useCloudStore.getState().name, parts: instances.length, rev: ++rev, by: session, updatedAt: Date.now(), createdAt, app: APP_VERSION };
  try {
    await be().write(code, doc);
    if (useCloudStore.getState().code !== code) return;
    lastData = data;
    setC({ status: pending ? 'saving' : 'saved', savedAt: Date.now(), error: null });
  } catch (e) {
    pending = true; // retry on the next edit or the retry button
    setC({ status: 'error', error: `Could not save online: ${errText(e)}` });
  }
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^FirebaseError:\s*/, '');

function onRemote(code: string, doc: CloudDoc | null) {
  if (useCloudStore.getState().code !== code || !doc) return;
  if (doc.name !== useCloudStore.getState().name) setC({ name: doc.name });
  rev = Math.max(rev, doc.rev);
  if (doc.by === session || doc.data === lastData) return;
  if (pending) return; // our unsaved edit is about to overwrite it (last write wins)
  const list = decodeCad(doc.data);
  if (!list) return;
  lastData = doc.data;
  applyRemote(list);
  setC({ remoteAt: Date.now(), status: 'saved', savedAt: doc.updatedAt });
}

function bind(code: string, doc: CloudDoc) {
  unbind();
  const my = ++binding;
  rev = doc.rev;
  lastData = doc.data;
  createdAt = doc.createdAt || Date.now();
  setC({ code, name: doc.name, status: 'saved', error: null, savedAt: doc.updatedAt, remoteAt: null });
  lsSet(LS_ACTIVE, code);
  remember(code, doc.name);
  unsubLocal = useCadStore.subscribe((s, p) => {
    if (s.instances === p.instances || applying || binding !== my) return;
    pending = true;
    if (useCloudStore.getState().status !== 'error') setC({ status: 'saving' });
    clearTimeout(timer);
    timer = setTimeout(() => void push(), 700);
  });
  unwatch = be().watch(
    code,
    (d) => onRemote(code, d),
    (e) => setC({ status: 'error', error: `Live sync stopped: ${errText(e)}` }),
  );
}

function unbind() {
  clearTimeout(timer);
  unwatch?.();
  unsubLocal?.();
  unwatch = unsubLocal = null;
  pending = false;
}

/** Keep the build that was on screen (not a cloud file) so it can be brought back after leaving. */
function stashLocal() {
  const st = useCadStore.getState();
  if (useCloudStore.getState().code || !st.instances.length) return;
  lsSet(LS_STASH, st.instances);
  setC({ stash: st.instances });
}

// ---------------------------------------------------------------- public API

/** Save the current build as a new online CAD file. Returns its access code. */
export async function createCloudFile(name: string): Promise<string | null> {
  if (!cloudConfigured()) return null;
  const instances = useCadStore.getState().instances;
  const data = encodeCad(instances);
  if (data.length > MAX_BYTES) {
    setC({ status: 'error', error: 'This build is too big to save online (over 1 MB).' });
    return null;
  }
  setC({ status: 'connecting', error: null });
  const now = Date.now();
  const doc: CloudDoc = { data, name: name.trim().slice(0, 80) || 'Untitled robot', parts: instances.length, rev: 1, by: session, updatedAt: now, createdAt: now, app: APP_VERSION };
  try {
    for (let k = 0; k < 8; k++) {
      const code = newCode();
      if (await be().create(code, doc)) {
        bind(code, doc);
        return code;
      }
    }
    throw new Error('no free code found, try again');
  } catch (e) {
    setC({ status: useCloudStore.getState().code ? 'saved' : 'off', error: `Could not create the online file: ${errText(e)}` });
    return null;
  }
}

/** Open an online CAD file by its 6-digit code (replaces the build on screen). */
export async function openCloudFile(code: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  code = code.replace(/\D/g, '');
  if (!isCode(code)) {
    setC({ error: 'Codes are 6 digits.' });
    return false;
  }
  if (!cloudConfigured()) return false;
  if (useCloudStore.getState().code === code && unwatch) return true;
  const prev = useCloudStore.getState();
  setC({ status: 'connecting', error: null });
  try {
    const doc = await be().get(code);
    if (!doc) {
      setC({ status: prev.code ? 'saved' : 'off', error: `No CAD file has the code ${code}.` });
      if (opts.quiet && localStorage.getItem(LS_ACTIVE) === JSON.stringify(code)) lsSet(LS_ACTIVE, null);
      return false;
    }
    const list = decodeCad(doc.data);
    if (!list) throw new Error('the file is damaged');
    stashLocal();
    unbind();
    applyRemote(list);
    useCadStore.temporal.getState().clear();
    bind(code, doc);
    if (!opts.quiet) useCadStore.getState().toast(`Opened “${doc.name}” (${list.length} parts) — changes save online`, 'ok');
    return true;
  } catch (e) {
    setC({ status: prev.code ? 'error' : 'off', error: `Could not open ${code}: ${errText(e)}` });
    return false;
  }
}

/** Stop syncing. The build stays on screen as a local copy. */
export function leaveCloud() {
  void push();
  unbind();
  binding++;
  lsSet(LS_ACTIVE, null);
  setC({ code: null, name: '', status: 'off', error: null, savedAt: null, remoteAt: null });
}

export function restoreStash() {
  const s = useCloudStore.getState().stash;
  if (!s) return;
  if (useCloudStore.getState().code) leaveCloud();
  useCadStore.getState().setInstances(s);
  lsSet(LS_STASH, null);
  setC({ stash: null });
}
export function dropStash() {
  lsSet(LS_STASH, null);
  setC({ stash: null });
}

export function renameCloudFile(name: string) {
  const st = useCloudStore.getState();
  const n = name.trim().slice(0, 80) || 'Untitled robot';
  if (!st.code || n === st.name) return;
  setC({ name: n });
  remember(st.code, n);
  pending = true;
  lastData = ''; // force a write even though the parts did not change
  void push();
}

export function retryCloud() {
  const code = useCloudStore.getState().code;
  if (!code) return;
  if (!unwatch) return void openCloudFile(code);
  pending = true;
  lastData = '';
  void push();
}

export const flushCloud = () => void push();

export function cloudLink(code: string) {
  return `${location.origin}${location.pathname}?cad=${code}`;
}

/** On load: a ?cad=123456 link wins, else reopen the file this browser had open last. */
export function startCloud({ openedShare = false } = {}) {
  if (!cloudConfigured()) return;
  const url = new URL(location.href);
  const fromUrl = (url.searchParams.get('cad') ?? location.hash.match(/cad=(\d{6})/)?.[1] ?? '').replace(/\D/g, '');
  if (isCode(fromUrl)) {
    url.searchParams.delete('cad');
    history.replaceState(null, '', url.pathname + url.search + location.hash.replace(/#?cad=\d{6}/, ''));
    void openCloudFile(fromUrl);
  } else if (!openedShare) {
    const active = lsGet<string | null>(LS_ACTIVE, null);
    if (active && isCode(active)) void openCloudFile(active, { quiet: true });
  }
  window.addEventListener('pagehide', flushCloud);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushCloud());
}
