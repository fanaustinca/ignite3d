import { lazy, Suspense, useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Inspector } from './components/Inspector';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { BomModal, ExportModal, HelpModal, SettingsModal, ShareModal } from './components/Modals';
import { UploadStudio } from './components/UploadStudio';
import { CheckPanel } from './components/CheckPanel';
import { CloudModal } from './components/CloudModal';
import { startCloud, useCloudStore } from './services/cloud';
import { initProjects, saveProjectBuild, useProjectStore } from './services/projects';
import { ProjectsModal } from './components/ProjectsModal';
import { runRobotCheck, startRobotCheck, useCheckStore } from './services/robotCheck';
import { Viewport, viewportBus } from './viewport/Viewport';
import { redo, undo, useCadStore } from './store/useCadStore';
import { loadFullCatalog, proceduralVisual, pruneMeshCache } from './services/assetLoader';
import { worldSnaps } from './lib/snap';
import { Group, Mesh } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { deleteCustomPart, listCustomParts, saveCustomPart } from './services/customParts';
import { readHashBuild, toBuildFile } from './lib/share';
import { download, buildStep, bomRows, buildStl, buildManifest } from './export/files';
import { buildExampleRobot } from './lib/example';
import { loadExample } from './lib/loadExample';
import { ensureAllSnaps } from './services/visuals';
import { completeOnshapeLogin, loadOnshapeSettings } from './services/onshape';
import { APP_VERSION } from './version';
import { loadBackup, loadBuild, loadBuildSync, saveBuild } from './services/autosave';
import type { PlacedInstance } from './types/cad';


// read before useBoot strips the hash: a share link must not be replaced by the last cloud file
const OPENED_SHARE = /build=/.test(location.hash);

function useBoot() {
  useEffect(() => {
    const st = useCadStore.getState();
    // 1. restore the build: share link wins over autosave
    const fromHash = readHashBuild();
    if (fromHash) {
      st.setInstances(fromHash);
      history.replaceState(null, '', location.pathname + location.search);
      st.toast(`Opened shared build (${fromHash.length} parts)`, 'ok');
      setTimeout(() => viewportBus.fit(), 300);
    } else {
      // localStorage copy right away, then the newest of localStorage / IndexedDB
      const quick = loadBuildSync();
      if (quick?.instances.length) {
        st.setInstances(quick.instances);
        setTimeout(() => viewportBus.fit(), 300);
      }
      const restored = useCadStore.getState().instances;
      loadBuild().then((b) => {
        const cur = useCadStore.getState();
        if (!b?.instances.length || (quick && b.savedAt <= quick.savedAt)) return;
        if (cur.instances !== restored) return; // the user already started editing
        cur.setInstances(b.instances);
        useCadStore.temporal.getState().clear();
        setTimeout(() => viewportBus.fit(), 300);
      });
    }
    initProjects();
    loadBackup().then((b) => b && useCadStore.getState().set({ backupBuild: b }));
    useCadStore.temporal.getState().clear();
    // 2. catalog: built-in now, remote + team + custom parts merged when they arrive
    (async () => {
      const custom = await listCustomParts();
      const res = await loadFullCatalog(useCadStore.getState().assetConfig, custom);
      useCadStore.getState().setCatalog(res.parts);
      pruneMeshCache(new Set(res.parts.filter((p) => !p.isCustom).map((p) => p.sku))).catch(() => {});
    })();
    // 3. first visit -> quick start
    try {
      if (!localStorage.getItem('ignite3d-welcomed') && !fromHash) {
        st.set({ modal: 'help' });
        localStorage.setItem('ignite3d-welcomed', '1');
      }
    } catch {
      /* ignore */
    }
    // 4. returning from Onshape OAuth
    if (location.search.includes('code=')) completeOnshapeLogin(loadOnshapeSettings()).then((t) => t && st.toast('Signed in to Onshape', 'ok')).catch((e) => st.toast(String(e), 'error'));
  }, []);

  // autosave: debounced while editing, flushed immediately when the tab is hidden / closed / reloaded
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    let pending: PlacedInstance[] | null = null;
    let pendingProject: string | null = null;
    let warned = false;
    const flush = () => {
      clearTimeout(t);
      if (!pending) return;
      const list = pending;
      pending = null;
      const ok = saveBuild(list);
      if (pendingProject) void saveProjectBuild(pendingProject, list);
      ok.then((good) => {
        useCadStore.getState().set({ savedAt: good ? Date.now() : null });
        if (!good && !warned) {
          warned = true;
          useCadStore.getState().toast('Could not autosave (browser storage is full or blocked) — use Ctrl+S to download your build.', 'error');
        }
      });
    };
    const unsub = useCadStore.subscribe((s, p) => {
      if (s.instances === p.instances) return;
      pending = s.instances;
      pendingProject = useProjectStore.getState().activeId;
      clearTimeout(t);
      t = setTimeout(flush, 300);
    });
    const hide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', hide);
    return () => {
      unsub();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
}

function useTheme() {
  const theme = useCadStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('ignite3d-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const st = useCadStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (st.modal) {
        if (e.key === 'Escape') st.set({ modal: null });
        return;
      }
      const handled = () => e.preventDefault();
      if (mod && k === 'z' && !e.shiftKey) return handled(), undo();
      if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) return handled(), redo();
      if (mod && k === 'g') return handled(), e.shiftKey ? st.ungroupSelected() : st.groupSelected();
      if (mod && k === 'd') return handled(), st.duplicateSelected();
      if (mod && k === 'a') return handled(), st.selectAll();
      if (mod && k === 's') return handled(), download('ignite3d-build.json', JSON.stringify(toBuildFile(st.instances), null, 1), 'application/json');
      if (mod) return;
      switch (e.key) {
        case 'Escape':
          if (st.placingSku) st.startPlacing(null);
          else if (st.tool !== 'select') st.set({ tool: 'select' });
          else st.select([]);
          return;
        case 'Tab':
          if (st.placingSku) {
            handled();
            st.set({ ghostAnchor: st.ghostAnchor + (e.shiftKey ? -1 : 1) });
          }
          return;
        case 'Delete':
        case 'Backspace':
          handled();
          st.removeSelected();
          return;
        case '[':
        case '{':
          st.nudgeSelected(e.shiftKey ? -8 : -1);
          return;
        case ']':
        case '}':
          st.nudgeSelected(e.shiftKey ? 8 : 1);
          return;
        case '?':
          st.set({ modal: 'help' });
          return;
        case '.':
        case 'Home':
          viewportBus.fit();
          return;
      }
      switch (k) {
        case 's':
          st.set({ snapEnabled: !st.snapEnabled });
          st.toast(`Hole snapping ${!st.snapEnabled ? 'ON' : 'OFF — free placement, use the gizmo grid'}`, 'info');
          return;
        case 'r':
          if (st.placingSku) st.set({ ghostRot: st.ghostRot + (e.shiftKey ? 1 : 2) });
          else st.rotateSelected(e.shiftKey ? 45 : 90);
          return;
        case 'w':
          st.set({ gizmoMode: 'translate' });
          return;
        case 'e':
          st.set({ gizmoMode: 'rotate' });
          return;
        case 'f':
          st.set({ tool: st.tool === 'fasten' ? 'select' : 'fasten', placingSku: null });
          return;
        case 'j':
          st.fastenJoint();
          return;
        case 'm':
          st.mirrorSelected(e.shiftKey ? 'z' : 'x');
          return;
        case 'h':
          if (e.altKey) st.unhideAll();
          else st.toggleHidden();
          return;
        case 'g':
          st.toggleGhost();
          return;
        case 'b':
          st.set({ showSizingCube: !st.showSizingCube });
          return;
        case 'c':
          st.set({ showCoG: !st.showCoG });
          return;
        case 'l':
          st.set({ modal: 'test' });
          return;
        case 'k': {
          const cs = useCheckStore.getState();
          cs.set({ open: !cs.open, focus: null });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// Small test/automation hook (used by the headless QA suite).
(window as unknown as Record<string, unknown>).__ignite = {
  cloud: useCloudStore,
  projects: useProjectStore,
  customParts: { save: saveCustomPart, remove: deleteCustomPart, list: listCustomParts },
  version: APP_VERSION,
  store: useCadStore,
  undo,
  redo,
  buildExampleRobot: () => buildExampleRobot(useCadStore.getState().catalog),
  loadExample: () => loadExample(),
  check: {
    run: () => runRobotCheck(),
    state: () => {
      const c = useCheckStore.getState();
      return { collisions: c.collisions, report: c.report, live: c.live, fresh: c.collisionsFresh, running: c.running };
    },
    store: useCheckStore,
  },
  ensureSnaps: (skus: string[]) => ensureAllSnaps(skus),
  exports: {
    step: () => buildStep(useCadStore.getState().instances, useCadStore.getState().catalog),
    stlBytes: () => buildStl(useCadStore.getState().instances, useCadStore.getState().catalog).byteLength,
    bom: () => bomRows(useCadStore.getState().instances, useCadStore.getState().catalog),
    manifest: () => buildManifest(useCadStore.getState().instances, useCadStore.getState().catalog),
  },
  fit: () => viewportBus.fit(),
  project: (p: [number, number, number]) => viewportBus.project(p),
  setView: (pos: [number, number, number], target: [number, number, number]) => viewportBus.setView(pos, target),
  ghost: () => (window as unknown as { __igniteGhost?: () => unknown }).__igniteGhost?.(),
  fastenTarget: () => (window as unknown as { __igniteFastenTarget?: () => unknown }).__igniteFastenTarget?.(),
  worldSnaps: (instanceId: string) => {
    const s = useCadStore.getState();
    const i = s.instances.find((x) => x.instanceId === instanceId);
    return i ? worldSnaps(i, s.catalog[i.sku]).map((w) => ({ id: w.snap.id, type: w.snap.type, pos: w.pos.toArray(), normal: w.normal.toArray(), tapped: !!w.snap.tapped, male: !!w.snap.male })) : [];
  },
  partGlb: async (sku: string) => {
    const part = useCadStore.getState().catalog[sku];
    const g = new Group();
    proceduralVisual(part).meshes.forEach((m) => g.add(new Mesh(m.geometry, m.material)));
    const buf = (await new GLTFExporter().parseAsync(g, { binary: true })) as ArrayBuffer;
    return Array.from(new Uint8Array(buf));
  },
};

const TestDrive = lazy(() => import('./sim/TestDrive'));

export default function App() {
  useEffect(() => startRobotCheck(), []);
  useEffect(() => startCloud({ openedShare: OPENED_SHARE }), []);
  useBoot();
  useTheme();
  useShortcuts();
  const modal = useCadStore((s) => s.modal);
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          <Viewport />
          <CheckPanel />
        </main>
        <Inspector />
      </div>
      <StatusBar />
      <Toasts />
      {modal === 'help' && <HelpModal />}
      {modal === 'share' && <ShareModal />}
      {modal === 'cloud' && <CloudModal />}
      {modal === 'projects' && <ProjectsModal />}
      {modal === 'bom' && <BomModal />}
      {modal === 'export' && <ExportModal />}
      {modal === 'settings' && <SettingsModal />}
      {modal === 'upload' && <UploadStudio />}
      {modal === 'test' && (
        <Suspense fallback={null}>
          <TestDrive />
        </Suspense>
      )}
    </div>
  );
}
