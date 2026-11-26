import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewcube, Grid, Html, OrbitControls, TransformControls } from '@react-three/drei';
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Plane,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Intersection,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { isFastener, isScrewSku, lockNutSku, planFastenAt, useCadStore } from '../store/useCadStore';
import { shcsSku } from '../data/catalog';
import { bestAlignment, occupiedFaces } from '../lib/placement';
import type { CatalogPart, PlacedInstance, Quat, SnapPoint, Vec3 } from '../types/cad';
import { useVisual } from '../services/visuals';
import { visualFor } from '../services/assetLoader';
import { compatible, instanceMatrix, mateTransform, q4, SNAP_COLORS, toQuat, toVec3, v3, worldSnaps, type WorldSnap } from '../lib/snap';
import { massProps, robotBounds, sizeCheck, SIZE_LIMIT_MM } from '../lib/metrics';
import { useCheckStore } from '../services/robotCheck';
import { chainKind, chainLinkMatrices, isChainSku, linkGeometry, resolveChains } from '../lib/chain';

// ------------------------------------------------------------------ shared registries

const pickables = new Set<Object3D>();
export const viewportBus = {
  fit: () => {},
  /** World (mm) -> client pixel coordinates. */
  project: (_p: Vec3) => ({ x: 0, y: 0 }),
  setView: (_pos: Vec3, _target: Vec3) => {},
  /** Swing the camera to look at a point from the current direction. */
  focus: (_p: Vec3) => {},
  gizmoDragging: false,
  /** Latest hover hit, exposed for tests and the status bar. */
  hover: null as null | { instanceId: string | null; point: Vec3 },
};

function ghostMaterial(m: Material, color = '#ff6a13') {
  const base = m as MeshStandardMaterial;
  return new MeshStandardMaterial({
    color: base.color ? base.color.clone().lerp(new Color(color), 0.45) : new Color(color),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    flatShading: true,
  });
}

const selMatCache = new WeakMap<Material, MeshStandardMaterial>();
function selectedMaterial(m: Material) {
  let s = selMatCache.get(m);
  if (!s) {
    const base = m as MeshStandardMaterial;
    s = new MeshStandardMaterial({
      color: base.color?.clone() ?? new Color('#ccc'),
      emissive: new Color('#ff6a13'),
      emissiveIntensity: 0.42,
      metalness: base.metalness ?? 0.3,
      roughness: base.roughness ?? 0.5,
      flatShading: true,
    });
    selMatCache.set(m, s);
  }
  return s;
}
const xrayCache = new WeakMap<Material, MeshStandardMaterial>();
function xrayMaterial(m: Material) {
  let s = xrayCache.get(m);
  if (!s) {
    const base = m as MeshStandardMaterial;
    s = new MeshStandardMaterial({ color: base.color?.clone() ?? new Color('#999'), transparent: true, opacity: 0.18, depthWrite: false, flatShading: true });
    xrayCache.set(m, s);
  }
  return s;
}

// ------------------------------------------------------------------ batches

function SkuBatch({ sku, list, mode }: { sku: string; list: PlacedInstance[]; mode: 'normal' | 'xray' }) {
  const visual = useVisual(sku);
  if (!visual) return null;
  return (
    <>
      {visual.meshes.map((m, k) => (
        <InstancedPart key={`${k}-${visual.source}`} geometry={m.geometry} material={mode === 'xray' ? xrayMaterial(m.material) : m.material} list={list} />
      ))}
    </>
  );
}

function InstancedPart({ geometry, material, list }: { geometry: Mesh['geometry']; material: Material; list: PlacedInstance[] }) {
  const ref = useRef<InstancedMesh>(null);
  const cap = Math.max(1, list.length);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    list.forEach((inst, i) => mesh.setMatrixAt(i, instanceMatrix(inst)));
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.userData = { pick: true, ids: list.map((i) => i.instanceId) };
    pickables.add(mesh);
    return () => {
      pickables.delete(mesh);
    };
  }, [list]);
  return <instancedMesh ref={ref} args={[geometry, material, cap]} frustumCulled={false} />;
}

function SelectedPart({ inst, preview }: { inst: PlacedInstance; preview?: { position: Vec3; quaternion: Quat } }) {
  const visual = useVisual(inst.sku);
  const ref = useRef<Group>(null);
  const t = preview ?? inst;
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((c) => {
      c.userData = { pick: true, id: inst.instanceId };
      pickables.add(c);
    });
    return () => g.children.forEach((c) => pickables.delete(c));
  }, [visual, inst.instanceId]);
  if (!visual) return null;
  return (
    <group ref={ref} position={t.position} quaternion={q4(t.quaternion)}>
      {visual.meshes.map((m, k) => (
        <mesh key={k} geometry={m.geometry} material={inst.ghosted ? xrayMaterial(m.material) : selectedMaterial(m.material)} />
      ))}
    </group>
  );
}

function HoverOverlay() {
  const hovered = useCadStore((s) => s.hovered);
  const inst = useCadStore((s) => s.instances.find((i) => i.instanceId === s.hovered));
  const placing = useCadStore((s) => !!s.placingSku);
  const selected = useCadStore((s) => (hovered ? s.selection.includes(hovered) : false));
  const visual = useVisual(inst?.sku ?? '');
  const mat = useMemo(() => new MeshBasicMaterial({ color: '#ff6a13', transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  if (!inst || !visual || placing || selected || isChainSku(inst.sku)) return null;
  return (
    <group position={inst.position} quaternion={q4(inst.quaternion)} raycast={() => null}>
      {visual.meshes.map((m, k) => (
        <mesh key={k} geometry={m.geometry} material={mat} raycast={() => null} />
      ))}
    </group>
  );
}

function PartsLayer() {
  const instances = useCadStore((s) => s.instances);
  const selection = useCadStore((s) => s.selection);
  const preview = useCadStore((s) => s.preview);
  const { normal, xray, selected } = useMemo(() => {
    const sel = new Set(selection);
    const normal = new Map<string, PlacedInstance[]>();
    const xray = new Map<string, PlacedInstance[]>();
    const selected: PlacedInstance[] = [];
    for (const i of instances) {
      if (i.hidden || isChainSku(i.sku)) continue;
      if (sel.has(i.instanceId)) {
        selected.push(i);
        continue;
      }
      const m = i.ghosted ? xray : normal;
      const l = m.get(i.sku);
      if (l) l.push(i);
      else m.set(i.sku, [i]);
    }
    return { normal, xray, selected };
  }, [instances, selection]);
  return (
    <group>
      {[...normal].map(([sku, list]) => (
        <SkuBatch key={`n-${sku}`} sku={sku} list={list} mode="normal" />
      ))}
      {[...xray].map(([sku, list]) => (
        <SkuBatch key={`x-${sku}`} sku={sku} list={list} mode="xray" />
      ))}
      {selected.map((i) => (
        <SelectedPart key={i.instanceId} inst={i} preview={preview?.[i.instanceId]} />
      ))}
      <ChainLayer />
    </group>
  );
}

// ------------------------------------------------------------------ chains (drawn around their two sprockets)

const linkGeo = linkGeometry();
const chainMats = new Map<string, MeshStandardMaterial>();
const chainMat = (color: string) => chainMats.get(color) ?? chainMats.set(color, new MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.5 })).get(color)!;

function ChainLayer() {
  const instances = useCadStore((s) => s.instances);
  const catalog = useCadStore((s) => s.catalog);
  const selection = useCadStore((s) => s.selection);
  const chains = useMemo(() => (instances.some((i) => isChainSku(i.sku)) ? resolveChains(instances, catalog) : []), [instances, catalog]);
  const sel = new Set(selection);
  return (
    <>
      {chains.map(({ chain, resolved }) => (
        <ChainMesh
          key={chain.instanceId}
          id={chain.instanceId}
          mats={resolved ? chainLinkMatrices(resolved) : danglingLinks(chain)}
          color={!resolved ? '#e5484d' : sel.has(chain.instanceId) ? '#ff6a13' : chainKind(chain.sku).color}
          ghost={chain.ghosted}
        />
      ))}
    </>
  );
}

/** A chain whose sprockets moved away: a short red run where it was, so it can be found and deleted. */
function danglingLinks(chain: PlacedInstance) {
  const m = instanceMatrix(chain);
  return Array.from({ length: 8 }, (_, k) => m.clone().multiply(new Matrix4().makeTranslation((k - 4) * 8, 0, 0)));
}

function ChainMesh({ id, mats, color, ghost }: { id: string; mats: Matrix4[]; color: string; ghost: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => (ghost ? xrayMaterial(chainMat(color)) : chainMat(color)), [color, ghost]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = mats.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData = { pick: true, ids: mats.map(() => id) };
    pickables.add(mesh);
    return () => {
      pickables.delete(mesh);
    };
  }, [mats, id]);
  return <instancedMesh key={mats.length} ref={ref} args={[linkGeo, material, Math.max(1, mats.length)]} frustumCulled={false} />;
}

// ------------------------------------------------------------------ interaction (ghost, snapping, fasten, selection)

interface Hit {
  instanceId: string | null;
  point: Vector3;
  normal: Vector3;
}

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

function anchorOrder(part: CatalogPart): SnapPoint[] {
  return [...part.snapPoints].sort((a, b) => {
    const m = Number(!!b.male) - Number(!!a.male);
    if (m) return m;
    const ay = Math.abs(a.normal[1]);
    const by = Math.abs(b.normal[1]);
    if (Math.abs(by - ay) > 1e-3) return by - ay;
    if (Math.abs(a.normal[1] - b.normal[1]) > 1e-3) return a.normal[1] - b.normal[1];
    return Math.hypot(...a.position) - Math.hypot(...b.position);
  });
}

const markerGeo = new TorusGeometry(2.7, 0.5, 6, 20);
const targetGeo = new TorusGeometry(4.2, 0.8, 8, 28);
const Z = new Vector3(0, 0, 1);

function Interaction() {
  const { camera, gl, scene } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);
  const ndc = useRef(new Vector2(-9, -9));
  const dirty = useRef(true);
  const down = useRef<{ x: number; y: number; b: number } | null>(null);
  const ghostRef = useRef<Group>(null);
  const markersRef = useRef<InstancedMesh>(null);
  const targetRef = useRef<Mesh>(null);
  const ghostState = useRef<{
    position: Vector3;
    quaternion: Quaternion;
    target: WorldSnap | null;
    anchor: SnapPoint | null;
    valid: boolean;
    /** Screw placement resolved by Smart Fasten (right length, head on the outer face, nut if needed). */
    fasten: { instanceId: string; snapId: string } | null;
  }>({
    position: new Vector3(),
    quaternion: new Quaternion(),
    target: null,
    anchor: null,
    valid: false,
    fasten: null,
  });
  const nutGhostRef = useRef<Group>(null);
  // Fasten tool: preview of the screw the planner would add at the hovered hole
  const fastenGhostRef = useRef<Group>(null);
  const [fastenSku, setFastenSku] = useState<string | null>(null);
  const fastenVisual = useVisual(fastenSku ?? '');
  const fastenMats = useMemo(() => fastenVisual?.meshes.map((m) => ghostMaterial(m.material)) ?? [], [fastenVisual]);
  useEffect(() => {
    dirty.current = true;
  }, [fastenVisual]);
  const catalogNow = useCadStore((s) => s.catalog);
  const nutVisual = useVisual(lockNutSku(catalogNow));
  const nutMats = useMemo(() => nutVisual?.meshes.map((m) => ghostMaterial(m.material)) ?? [], [nutVisual]);
  const occCache = useRef<{ instances: PlacedInstance[] | null; set: Set<WorldSnap> }>({ instances: null, set: new Set() });
  const fastenTarget = useRef<WorldSnap | null>(null);
  const placingSku = useCadStore((s) => s.placingSku);
  const ghostVisual = useVisual(placingSku ?? '');
  const ghostMats = useMemo(() => ghostVisual?.meshes.map((m) => ghostMaterial(m.material)) ?? [], [ghostVisual]);
  const anchorCache = useRef<{ part: CatalogPart | null; list: SnapPoint[] }>({ part: null, list: [] });
  const anchorsFor = (part: CatalogPart) => {
    if (anchorCache.current.part !== part) anchorCache.current = { part, list: anchorOrder(part) };
    return anchorCache.current.list;
  };
  const snapCache = useRef(new Map<string, { key: PlacedInstance; part: CatalogPart; snaps: WorldSnap[] }>());
  const bestRot = useRef<{ key: string; k: number }>({ key: '', k: 0 });

  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.current.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      dirty.current = true;
    };
    const pdown = (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY, b: e.button };
    };
    const pup = (e: PointerEvent) => {
      const d = down.current;
      down.current = null;
      if (!d || viewportBus.gizmoDragging) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      move(e);
      if (d.b === 2) {
        const st = useCadStore.getState();
        if (st.placingSku) st.startPlacing(null);
        else if (st.tool === 'fasten' || st.tool === 'chain') st.set({ tool: 'select', chainFirst: null });
        return;
      }
      if (d.b !== 0) return;
      onClick(e.shiftKey || e.ctrlKey || e.metaKey);
    };
    const leave = () => {
      ndc.current.set(-9, -9);
      dirty.current = true;
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointerup', pup);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerdown', pdown);
      el.removeEventListener('pointerup', pup);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('contextmenu', ctx);
    };
  });

  // any state change that affects the ghost re-evaluates it
  useEffect(
    () =>
      useCadStore.subscribe((s, p) => {
        if (
          s.ghostRot !== p.ghostRot ||
          s.ghostAnchor !== p.ghostAnchor ||
          s.snapEnabled !== p.snapEnabled ||
          s.instances !== p.instances ||
          s.gridStep !== p.gridStep ||
          s.placingSku !== p.placingSku ||
          s.tool !== p.tool ||
          s.catalog !== p.catalog
        )
          dirty.current = true;
      }),
    [],
  );

  function worldSnapsCached(inst: PlacedInstance, part: CatalogPart) {
    const c = snapCache.current.get(inst.instanceId);
    if (c && c.key === inst && c.part === part) return c.snaps;
    const snaps = worldSnaps(inst, part);
    snapCache.current.set(inst.instanceId, { key: inst, part, snaps });
    return snaps;
  }

  function pick(): Hit | null {
    raycaster.setFromCamera(ndc.current, camera);
    const hits: Intersection[] = raycaster.intersectObjects([...pickables], false);
    for (const h of hits) {
      const o = h.object;
      if (!o.visible || !h.face) continue;
      let id: string | null = null;
      const nm = new Matrix4().copy(o.matrixWorld);
      if ((o as InstancedMesh).isInstancedMesh && h.instanceId !== undefined) {
        id = o.userData.ids?.[h.instanceId] ?? null;
        const im = new Matrix4();
        (o as InstancedMesh).getMatrixAt(h.instanceId, im);
        nm.multiply(im);
      } else id = o.userData.id ?? null;
      const n = h.face.normal.clone().transformDirection(nm);
      if (n.dot(raycaster.ray.direction) > 0) n.negate();
      return { instanceId: id, point: h.point.clone(), normal: n };
    }
    const p = new Vector3();
    if (raycaster.ray.intersectPlane(GROUND, p)) return { instanceId: null, point: p, normal: new Vector3(0, 1, 0) };
    return null;
  }

  function snapRadius() {
    return Math.min(40, Math.max(7, camera.position.length() * 0.018));
  }

  function setMarkers(list: WorldSnap[]) {
    const m = markersRef.current;
    if (!m) return;
    const n = Math.min(list.length, 1500);
    const mat = new Matrix4();
    const q = new Quaternion();
    const col = new Color();
    for (let i = 0; i < n; i++) {
      const s = list[i];
      q.setFromUnitVectors(Z, s.normal);
      mat.compose(s.pos.clone().addScaledVector(s.normal, 0.25), q, new Vector3(1, 1, 1));
      m.setMatrixAt(i, mat);
      m.setColorAt(i, col.set(SNAP_COLORS[s.snap.type]));
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  function showTarget(s: WorldSnap | null) {
    const t = targetRef.current;
    if (!t) return;
    t.visible = !!s;
    if (s) {
      t.position.copy(s.pos).addScaledVector(s.normal, 0.35);
      t.quaternion.setFromUnitVectors(Z, s.normal);
    }
  }

  useFrame(({ clock }) => {
    if (targetRef.current?.visible) {
      const k = 1 + Math.sin(clock.elapsedTime * 7) * 0.12;
      targetRef.current.scale.setScalar(k);
    }
    if (!dirty.current) return;
    dirty.current = false;
    const st = useCadStore.getState();
    const hit = pick();
    viewportBus.hover = hit ? { instanceId: hit.instanceId, point: toVec3(hit.point) } : null;
    const hovered = hit?.instanceId ?? null;
    if (hovered !== st.hovered) st.set({ hovered });

    const hovInst = hovered ? st.instances.find((i) => i.instanceId === hovered) : undefined;
    const hovPart = hovInst ? st.catalog[hovInst.sku] : undefined;
    const faceSnaps = (filter: (s: WorldSnap) => boolean) =>
      hovInst && hovPart && hit ? worldSnapsCached(hovInst, hovPart).filter((s) => s.normal.dot(hit.normal) > 0.7 && filter(s)) : [];

    // ---------- fasten tool
    if (st.tool === 'fasten' && !st.placingSku) {
      const cands = faceSnaps((s) => (s.snap.type === 'm4_hole' || s.snap.type === 'hub_pattern_16mm') && !s.snap.male);
      setMarkers(cands);
      let best: WorldSnap | null = null;
      let bd = snapRadius();
      if (hit) for (const s of cands) {
        const d = s.pos.distanceTo(hit.point);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      fastenTarget.current = best;
      showTarget(best);
      const fg = fastenGhostRef.current;
      const ng = nutGhostRef.current;
      if (fg) fg.visible = false;
      if (ng) ng.visible = false;
      if (best) {
        const plan = planFastenAt(st.instances, st.catalog, best.instanceId, best.snap.id);
        if (plan.ok) {
          const sku = shcsSku(plan.screwLength);
          if (sku !== fastenSku) setFastenSku(sku);
          if (fg) {
            fg.position.set(...plan.screw.position);
            fg.quaternion.set(...plan.screw.quaternion);
            fg.visible = sku === fastenSku;
          }
          if (ng && plan.nut) {
            ng.position.set(...plan.nut.position);
            ng.quaternion.set(...plan.nut.quaternion);
            ng.visible = true;
          }
          const info = `Click: M4×${plan.screwLength}${plan.nut ? ' + locknut' : ' into threads'} · grip ${plan.grip.toFixed(1)} mm`;
          if (st.lastSnapInfo !== info) st.set({ lastSnapInfo: info });
        } else if (st.lastSnapInfo !== plan.reason) st.set({ lastSnapInfo: plan.reason });
      }
      gl.domElement.style.cursor = best ? 'crosshair' : 'default';
      return;
    }
    fastenTarget.current = null;
    if (fastenGhostRef.current) fastenGhostRef.current.visible = false;

    // ---------- placing (read from the store, not React state, so the first mouse move after
    // picking a part is never lost to a render that has not committed yet)
    const g = ghostRef.current;
    const ghostPart = st.placingSku ? st.catalog[st.placingSku] : null;
    if (!st.placingSku || !ghostPart || !g) {
      setMarkers([]);
      showTarget(null);
      if (g) g.visible = false;
      if (nutGhostRef.current) nutGhostRef.current.visible = false;
      gl.domElement.style.cursor = hovered ? 'pointer' : 'default';
      return;
    }
    gl.domElement.style.cursor = 'crosshair';
    const gs = ghostState.current;
    gs.target = null;
    gs.anchor = null;
    gs.fasten = null;
    gs.valid = !!hit;
    if (nutGhostRef.current) nutGhostRef.current.visible = false;
    if (!hit) {
      g.visible = false;
      setMarkers([]);
      showTarget(null);
      return;
    }
    g.visible = true;
    let snapped = false;
    const anchors = anchorsFor(ghostPart);
    if (occCache.current.instances !== st.instances)
      occCache.current = { instances: st.instances, set: occupiedFaces(st.instances, st.catalog, worldSnapsCached) };
    const occupied = occCache.current.set;

    // ---------- screws: a hand-placed screw is Smart Fasten — the planner picks the length, puts the head on
    // the outside of the stack and adds a locknut, so it can never stick out or sink into a wall.
    if (st.snapEnabled && hovInst && hovPart && isScrewSku(ghostPart.sku) && !isFastener(hovInst.sku)) {
      const cands = faceSnaps((s) => (s.snap.type === 'm4_hole' || s.snap.type === 'hub_pattern_16mm') && !s.snap.male);
      setMarkers(cands);
      const byDist = cands
        .map((s) => ({ s, d: s.pos.distanceTo(hit.point) }))
        .filter((x) => x.d < snapRadius())
        .sort((a, b) => a.d - b.d);
      const best = byDist[0]?.s ?? null;
      if (best) {
        const plan = planFastenAt(st.instances, st.catalog, best.instanceId, best.snap.id);
        if (plan.ok) {
          const want = shcsSku(plan.screwLength);
          if (want !== st.placingSku && st.catalog[want]) {
            // swap the ghost to the screw length the joint needs (re-evaluated on the next frame)
            st.set({ placingSku: want, lastSnapInfo: `Auto length: M4×${plan.screwLength} for a ${plan.grip.toFixed(1)} mm grip` });
            dirty.current = true;
          }
          gs.position.copy(v3(plan.screw.position));
          gs.quaternion.copy(q4(plan.screw.quaternion));
          gs.fasten = { instanceId: best.instanceId, snapId: best.snap.id };
          gs.target = best;
          const ng = nutGhostRef.current;
          if (ng && plan.nut) {
            ng.position.set(...plan.nut.position);
            ng.quaternion.set(...plan.nut.quaternion);
            ng.visible = true;
          }
          showTarget(best);
          g.visible = true;
          g.position.copy(gs.position);
          g.quaternion.copy(gs.quaternion);
          return;
        }
        st.set({ lastSnapInfo: plan.reason });
      }
      // no joint here: a lone screw can still sit on an exposed hole face (below)
    }

    if (st.snapEnabled && hovInst) {
      const cands = faceSnaps((s) => !occupied.has(s) && anchors.some((a) => compatible(a, s.snap)));
      setMarkers(cands);
      let best: WorldSnap | null = null;
      let bd = snapRadius();
      for (const s of cands) {
        const d = s.pos.distanceTo(hit.point);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best) {
        const compat = anchors.filter((a) => compatible(a, best!.snap));
        const anchor = compat[((st.ghostAnchor % compat.length) + compat.length) % compat.length];
        // default rotation = the 90° step that lines up the most holes; R steps from there
        const key = `${best.instanceId}|${best.snap.id}|${anchor.id}|${ghostPart.sku}`;
        if (bestRot.current.key !== key) bestRot.current = { key, k: bestAlignment(anchor, best, ghostPart, worldSnapsCached(hovInst, hovPart!)) };
        const m = mateTransform(anchor, best, bestRot.current.k * (Math.PI / 2) + (st.ghostRot * Math.PI) / 4);
        gs.position.copy(m.position);
        gs.quaternion.copy(m.quaternion);
        gs.target = best;
        gs.anchor = anchor;
        snapped = true;
        showTarget(best);
      } else showTarget(null);
    } else {
      setMarkers([]);
      showTarget(null);
    }
    if (!snapped) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (st.ghostRot * Math.PI) / 4);
      const b = visualFor(ghostPart).bounds.clone().applyMatrix4(new Matrix4().makeRotationFromQuaternion(q));
      const p = hit.point.clone();
      const step = st.gridStep;
      if (step > 0 && !hovInst) {
        p.x = Math.round(p.x / step) * step;
        p.z = Math.round(p.z / step) * step;
      }
      if (hit.normal.y > 0.7) p.y -= b.min.y;
      else p.addScaledVector(hit.normal, b.getSize(new Vector3()).length() / 2);
      gs.position.copy(p);
      gs.quaternion.copy(q);
    }
    g.position.copy(gs.position);
    g.quaternion.copy(gs.quaternion);
  });

  function onClick(additive: boolean) {
    dirty.current = true;
    const st = useCadStore.getState();
    if (st.tool === 'fasten' && !st.placingSku) {
      const t = fastenTarget.current;
      if (t) st.fastenAt(t.instanceId, t.snap.id);
      else st.toast('Hover an M4 hole on a joint (orange rings) and click it.', 'info');
      return;
    }
    if (st.tool === 'chain' && !st.placingSku) {
      raycaster.setFromCamera(ndc.current, camera);
      st.chainClick(pick()?.instanceId ?? null);
      return;
    }
    if (st.placingSku) {
      const gs = ghostState.current;
      if (!gs.valid) return;
      if (gs.fasten) {
        st.fastenAt(gs.fasten.instanceId, gs.fasten.snapId);
        return;
      }
      const id = st.addInstance({
        sku: st.placingSku,
        position: toVec3(gs.position),
        quaternion: toQuat(gs.quaternion),
        snapAxis: gs.target ? toVec3(gs.target.normal) : undefined,
        snapPivot: gs.target ? toVec3(gs.target.pos) : undefined,
      });
      const part = st.catalog[st.placingSku];
      if (gs.target && gs.anchor) {
        const tp = st.catalog[gs.target.sku];
        st.set({ lastSnapInfo: `Snapped ${part.name} · ${gs.anchor.type} → ${gs.target.snap.type} on ${tp?.name ?? gs.target.sku}` });
      } else st.set({ lastSnapInfo: `Placed ${part.name} (free)` });
      void id;
      return;
    }
    // selection
    raycaster.setFromCamera(ndc.current, camera);
    const hit = pick();
    if (hit?.instanceId) st.select([hit.instanceId], additive);
    else if (!additive) st.select([]);
  }

  // expose for headless tests
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ignitePick = (x: number, y: number) => {
      ndc.current.set(x, y);
      dirty.current = true;
    };
    (window as unknown as Record<string, unknown>).__igniteClick = (additive = false) => onClick(additive);
    (window as unknown as Record<string, unknown>).__igniteFastenTarget = () =>
      fastenTarget.current ? { instanceId: fastenTarget.current.instanceId, snap: fastenTarget.current.snap.id, pos: toVec3(fastenTarget.current.pos) } : null;
    (window as unknown as Record<string, unknown>).__igniteGhost = () => ({
      position: toVec3(ghostState.current.position),
      quaternion: toQuat(ghostState.current.quaternion),
      target: ghostState.current.target ? { instanceId: ghostState.current.target.instanceId, snap: ghostState.current.target.snap.id, type: ghostState.current.target.snap.type } : null,
      anchor: ghostState.current.anchor?.id ?? null,
      fasten: ghostState.current.fasten,
    });
    void scene;
  });

  return (
    <>
      <group ref={ghostRef} visible={false}>
        {ghostVisual?.meshes.map((m, k) => <mesh key={k} geometry={m.geometry} material={ghostMats[k]} raycast={() => null} />)}
      </group>
      <group ref={fastenGhostRef} visible={false}>
        {fastenVisual?.meshes.map((m, k) => <mesh key={k} geometry={m.geometry} material={fastenMats[k]} raycast={() => null} />)}
      </group>
      <group ref={nutGhostRef} visible={false}>
        {nutVisual?.meshes.map((m, k) => <mesh key={k} geometry={m.geometry} material={nutMats[k]} raycast={() => null} />)}
      </group>
      <instancedMesh ref={markersRef} args={[markerGeo, undefined, 1500]} frustumCulled={false} raycast={() => null} count={0}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <mesh ref={targetRef} geometry={targetGeo} visible={false} raycast={() => null} renderOrder={10}>
        <meshBasicMaterial color="#ff6a13" toneMapped={false} depthTest={false} transparent />
      </mesh>
    </>
  );
}


// ------------------------------------------------------------------ rotation rings (shown with the move arrows)

const RING_AXES: { axis: Vector3; color: string; rot: [number, number, number]; name: string }[] = [
  { axis: new Vector3(1, 0, 0), color: '#ef4444', rot: [0, Math.PI / 2, 0], name: 'X' },
  { axis: new Vector3(0, 1, 0), color: '#22c55e', rot: [Math.PI / 2, 0, 0], name: 'Y' },
  { axis: new Vector3(0, 0, 1), color: '#3b82f6', rot: [0, 0, 0], name: 'Z' },
];
const ringGeo = new TorusGeometry(1, 0.014, 6, 96);
const ringPickGeo = new TorusGeometry(1, 0.075, 6, 48);
const ringTickGeo = new BoxGeometry(0.02, 0.09, 0.02);

/**
 * Three rotation rings around the selection, drawn together with the move arrows so parts can be turned
 * without switching gizmo modes. Dragging a ring turns the selection about that world axis through the
 * selection centre, snapping to the rotate increment (45° by default).
 */
function RotationRings({ sel, center }: { sel: PlacedInstance[]; center: Vector3 }) {
  const { camera, gl, controls } = useThree();
  const group = useRef<Group>(null);
  const angleStep = useCadStore((s) => s.angleStep);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ k: number; deg: number } | null>(null);
  const ticks = useMemo(() => {
    const out: { p: Vec3; r: number }[] = [];
    for (let i = 0; i < 8; i++) out.push({ p: [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4), 0], r: (i * Math.PI) / 4 });
    return out;
  }, []);

  useFrame(() => {
    const gr = group.current;
    if (!gr) return;
    gr.position.copy(center);
    const persp = camera as unknown as { fov?: number };
    const f = Math.tan(((persp.fov ?? 40) * Math.PI) / 360);
    gr.scale.setScalar(camera.position.distanceTo(center) * f * 0.36);
  });

  const begin = (k: number, e: { stopPropagation: () => void; point: Vector3; nativeEvent: PointerEvent }) => {
    e.stopPropagation();
    if (e.nativeEvent.button !== 0) return;
    viewportBus.gizmoDragging = true;
    const oc = controls as unknown as { enabled: boolean } | null;
    if (oc) oc.enabled = false;
    const axis = RING_AXES[k].axis.clone();
    const plane = new Plane().setFromNormalAndCoplanarPoint(axis, center);
    const rc = new Raycaster();
    const ndc = new Vector2();
    const onPlane = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      rc.setFromCamera(ndc, camera);
      const p = new Vector3();
      return rc.ray.intersectPlane(plane, p) ? p.sub(center) : null;
    };
    const v0 = onPlane(e.nativeEvent) ?? e.point.clone().sub(center).projectOnPlane(axis);
    const items = new Map(sel.map((i) => [i.instanceId, instanceMatrix(i)]));
    let last = 0;
    setDrag({ k, deg: 0 });
    const move = (ev: PointerEvent) => {
      const v = onPlane(ev);
      if (!v || v.lengthSq() < 1e-6) return;
      let ang = Math.atan2(v0.clone().cross(v).dot(axis), v0.dot(v));
      const step = useCadStore.getState().angleStep;
      if (step > 0) ang = Math.round(ang / ((step * Math.PI) / 180)) * ((step * Math.PI) / 180);
      if (Math.abs(ang - last) < 1e-9) return;
      last = ang;
      const delta = new Matrix4()
        .makeTranslation(center.x, center.y, center.z)
        .multiply(new Matrix4().makeRotationAxis(axis, ang))
        .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      const prev: Record<string, { position: Vec3; quaternion: Quat }> = {};
      const pos = new Vector3();
      const q = new Quaternion();
      const sc = new Vector3();
      for (const [id, m] of items) {
        delta.clone().multiply(m).decompose(pos, q, sc);
        prev[id] = { position: toVec3(pos), quaternion: toQuat(q.normalize()) };
      }
      useCadStore.getState().set({ preview: prev });
      setDrag({ k, deg: Math.round((ang * 180) / Math.PI) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const st = useCadStore.getState();
      if (st.preview) st.updateTransforms(st.preview);
      st.set({ preview: null });
      if (oc) oc.enabled = true;
      setDrag(null);
      setTimeout(() => (viewportBus.gizmoDragging = false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <group ref={group}>
      {RING_AXES.map((a, k) => {
        const active = drag ? drag.k === k : hover === k;
        if (drag && drag.k !== k) return null;
        return (
          <group key={a.name} rotation={a.rot}>
            <mesh geometry={ringGeo} renderOrder={31} raycast={() => null}>
              <meshBasicMaterial color={active ? '#ff6a13' : a.color} depthTest={false} transparent opacity={active ? 1 : 0.85} toneMapped={false} />
            </mesh>
            {active &&
              ticks.map((t, i) => (
                <mesh key={i} geometry={ringTickGeo} position={t.p} rotation={[0, 0, t.r]} renderOrder={31} raycast={() => null}>
                  <meshBasicMaterial color="#ff6a13" depthTest={false} transparent toneMapped={false} />
                </mesh>
              ))}
            <mesh
              geometry={ringPickGeo}
              userData={{ ring: a.name }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(k);
                gl.domElement.style.cursor = 'grab';
              }}
              onPointerOut={() => {
                setHover((h) => (h === k ? null : h));
                gl.domElement.style.cursor = 'default';
              }}
              onPointerDown={(e) => begin(k, e)}
            >
              <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
            </mesh>
          </group>
        );
      })}
      {drag && (
        <Html center style={{ pointerEvents: 'none' }} position={[0, 0, 0]}>
          <div data-testid="rotate-readout" className="whitespace-nowrap rounded-md bg-accent px-2 py-0.5 text-[12px] font-semibold text-white shadow num">
            {RING_AXES[drag.k].name} {drag.deg > 0 ? '+' : ''}
            {drag.deg}°{angleStep > 0 ? ` · ${angleStep}° steps` : ''}
          </div>
        </Html>
      )}
    </group>
  );
}

// ------------------------------------------------------------------ gizmo

function SelectionGizmo() {
  const selection = useCadStore((s) => s.selection);
  const instances = useCadStore((s) => s.instances);
  const mode = useCadStore((s) => s.gizmoMode);
  const gridStep = useCadStore((s) => s.gridStep);
  const angleStep = useCadStore((s) => s.angleStep);
  const placing = useCadStore((s) => !!s.placingSku);
  const tool = useCadStore((s) => s.tool);
  const pivot = useRef<Group>(null);
  const [pivotObj, setPivotObj] = useState<Group | null>(null);
  const [moving, setMoving] = useState(false);
  const start = useRef<{ pivot: Matrix4; items: Map<string, Matrix4> } | null>(null);
  const sel = useMemo(() => instances.filter((i) => selection.includes(i.instanceId) && !i.hidden), [instances, selection]);

  useLayoutEffect(() => {
    const p = pivot.current;
    if (!p || start.current) return;
    if (!sel.length) return;
    const c = sel.reduce((a, i) => a.add(v3(i.position)), new Vector3()).multiplyScalar(1 / sel.length);
    p.position.copy(c);
    p.quaternion.set(0, 0, 0, 1);
    p.updateMatrix();
    setPivotObj(p);
  }, [sel]);

  const center = useMemo(() => sel.reduce((a, i) => a.add(v3(i.position)), new Vector3()).multiplyScalar(1 / Math.max(1, sel.length)), [sel]);
  if (!sel.length || placing || tool !== 'select') return <group ref={pivot} />;
  return (
    <>
      <group ref={pivot} />
      {mode === 'translate' && !moving && <RotationRings sel={sel} center={center} />}
      {pivotObj && (
        <TransformControls
          object={pivotObj}
          mode={mode}
          space="world"
          size={0.8}
          translationSnap={gridStep > 0 ? gridStep : null}
          rotationSnap={angleStep > 0 ? (angleStep * Math.PI) / 180 : null}
          onMouseDown={() => {
            viewportBus.gizmoDragging = true;
            setMoving(true);
            const p = pivot.current!;
            p.updateMatrix();
            start.current = { pivot: p.matrix.clone(), items: new Map(sel.map((i) => [i.instanceId, instanceMatrix(i)])) };
          }}
          onObjectChange={() => {
            const s = start.current;
            const p = pivot.current;
            if (!s || !p) return;
            p.updateMatrix();
            const delta = p.matrix.clone().multiply(s.pivot.clone().invert());
            const prev: Record<string, { position: Vec3; quaternion: Quat }> = {};
            const pos = new Vector3();
            const q = new Quaternion();
            const sc = new Vector3();
            for (const [id, m] of s.items) {
              delta.clone().multiply(m).decompose(pos, q, sc);
              prev[id] = { position: toVec3(pos), quaternion: toQuat(q.normalize()) };
            }
            useCadStore.getState().set({ preview: prev });
          }}
          onMouseUp={() => {
            const st = useCadStore.getState();
            if (st.preview) st.updateTransforms(st.preview);
            st.set({ preview: null });
            start.current = null;
            setMoving(false);
            setTimeout(() => (viewportBus.gizmoDragging = false), 0);
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ overlays

const cubeEdges = new EdgesGeometry(new BoxGeometry(SIZE_LIMIT_MM, SIZE_LIMIT_MM, SIZE_LIMIT_MM));

function SizingCube() {
  const show = useCadStore((s) => s.showSizingCube);
  const instances = useCadStore((s) => s.instances);
  const catalog = useCadStore((s) => s.catalog);
  const vv = useCadStore((s) => s.visualVersion);
  const info = useMemo(() => {
    const b = robotBounds(instances, catalog);
    return { b, chk: sizeCheck(b) };
  }, [instances, catalog, vv]); // eslint-disable-line react-hooks/exhaustive-deps
  const mat = useMemo(() => new LineBasicMaterial({ color: '#22c55e' }), []);
  if (!show) return null;
  const over = info.chk.over;
  mat.color.set(over ? '#ef4444' : '#22c55e');
  const b = info.b.isEmpty() ? new Box3(new Vector3(-1, 0, -1), new Vector3(1, 1, 1)) : info.b;
  const c = b.getCenter(new Vector3());
  const pos: Vec3 = [c.x, b.min.y + SIZE_LIMIT_MM / 2, c.z];
  const s = info.chk.size;
  return (
    <group>
      <lineSegments geometry={cubeEdges} material={mat} position={pos} raycast={() => null} />
      <mesh position={pos} raycast={() => null}>
        <boxGeometry args={[SIZE_LIMIT_MM, SIZE_LIMIT_MM, SIZE_LIMIT_MM]} />
        <meshBasicMaterial color={over ? '#ef4444' : '#22c55e'} transparent opacity={0.05} depthWrite={false} side={DoubleSide} />
      </mesh>
      <Html position={[pos[0], b.min.y, pos[2] + SIZE_LIMIT_MM / 2]} center style={{ pointerEvents: 'none' }}>
        <div
          data-testid="sizing-label"
          className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium shadow num ${over ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
        >
          18″ cube · {(s.x / 25.4).toFixed(1)} × {(s.z / 25.4).toFixed(1)} × {(s.y / 25.4).toFixed(1)} in {over ? `· OVER (${info.chk.axes.join(', ')})` : '· fits'}
        </div>
      </Html>
    </group>
  );
}

const cogGeo = new SphereGeometry(7, 20, 14);
function CoGMarker() {
  const show = useCadStore((s) => s.showCoG);
  const instances = useCadStore((s) => s.instances);
  const catalog = useCadStore((s) => s.catalog);
  const m = useMemo(() => massProps(instances, catalog), [instances, catalog]);
  if (!show || !m.cog) return null;
  const c = m.cog;
  return (
    <group raycast={() => null}>
      <mesh geometry={cogGeo} position={c} renderOrder={20} raycast={() => null}>
        <meshBasicMaterial color="#ff6a13" depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh position={[c.x, c.y / 2, c.z]} renderOrder={19} raycast={() => null}>
        <cylinderGeometry args={[0.8, 0.8, Math.max(0.1, c.y), 8]} />
        <meshBasicMaterial color="#ff6a13" depthTest={false} transparent opacity={0.6} />
      </mesh>
      <mesh position={[c.x, 0.3, c.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[9, 12, 32]} />
        <meshBasicMaterial color="#ff6a13" />
      </mesh>
      <Html position={[c.x, c.y + 18, c.z]} center style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-white shadow num">
          CoG {c.x.toFixed(0)}, {c.y.toFixed(0)}, {c.z.toFixed(0)} mm
        </div>
      </Html>
    </group>
  );
}

// ------------------------------------------------------------------ robot check overlay

const hitGeo = new SphereGeometry(4.5, 16, 12);
const issueGeo = new SphereGeometry(3.5, 12, 10);
const clashMat = new MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
const focusMat = new MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });

function ClashPart({ inst, mat }: { inst: PlacedInstance; mat: Material }) {
  const visual = useVisual(inst.sku);
  if (!visual) return null;
  return (
    <group position={inst.position} quaternion={q4(inst.quaternion)} raycast={() => null}>
      {visual.meshes.map((m, k) => (
        <mesh key={k} geometry={m.geometry} material={mat} raycast={() => null} renderOrder={5} />
      ))}
    </group>
  );
}

function CheckOverlay() {
  const cs = useCheckStore();
  const instances = useCadStore((s) => s.instances);
  const byId = useMemo(() => new Map(instances.map((i) => [i.instanceId, i])), [instances]);
  const clashIds = useMemo(() => new Set(cs.collisions.flatMap((c) => [c.a, c.b])), [cs.collisions]);
  const focus = new Set((cs.open && cs.focus) || []);
  const st = cs.open && cs.stability ? cs.report?.stability : null;
  const hullGeo = useMemo(() => {
    if (!st || st.hull.length < 2) return null;
    const pts = st.hull.map(([x, z]) => new Vector3(x, st.groundY + 0.6, z));
    return new Line(new BufferGeometry().setFromPoints([...pts, pts[0]]), new LineBasicMaterial({ color: '#ff6a13' }));
  }, [st]);
  return (
    <group raycast={() => null}>
      {[...clashIds].map((id) => {
        const i = byId.get(id);
        return i && !i.hidden && !focus.has(id) ? <ClashPart key={`c-${id}`} inst={i} mat={clashMat} /> : null;
      })}
      {[...focus].map((id) => {
        const i = byId.get(id);
        return i && !i.hidden ? <ClashPart key={`f-${id}`} inst={i} mat={focusMat} /> : null;
      })}
      {cs.collisions.slice(0, 200).map((c) => (
        <mesh key={`p-${c.a}|${c.b}`} geometry={hitGeo} position={c.point} renderOrder={21} raycast={() => null}>
          <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
        </mesh>
      ))}
      {cs.open &&
        cs.report?.issues
          .filter((i) => i.point && i.kind !== 'stability' && (i.level === 'error' || i.level === 'warn'))
          .slice(0, 200)
          .map((i, k) => (
            <mesh key={`i-${k}`} geometry={issueGeo} position={i.point!} renderOrder={21} raycast={() => null}>
              <meshBasicMaterial color={i.level === 'error' ? '#dc2626' : '#f59e0b'} depthTest={false} transparent opacity={0.85} />
            </mesh>
          ))}
      {st && hullGeo && (
        <>
          <primitive object={hullGeo} />
          {st.cog && (
            <mesh position={[st.cog[0], st.groundY + 0.7, st.cog[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <ringGeometry args={[5, 9, 28]} />
              <meshBasicMaterial color={st.ok ? '#ff6a13' : '#ef4444'} side={DoubleSide} />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}

// ------------------------------------------------------------------ camera helpers

function CameraRig() {
  const { camera, controls, gl } = useThree();
  useEffect(() => {
    viewportBus.project = (p: Vec3) => {
      camera.updateMatrixWorld();
      const v = new Vector3(...p).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    viewportBus.setView = (pos: Vec3, target: Vec3) => {
      camera.position.set(...pos);
      const oc = controls as unknown as OrbitControlsImpl | null;
      if (oc) {
        oc.target.set(...target);
        oc.update();
      } else camera.lookAt(...target);
      camera.updateMatrixWorld();
    };
    viewportBus.focus = (p: Vec3) => {
      const oc = controls as unknown as OrbitControlsImpl | null;
      const t = new Vector3(...p);
      const from = oc ? oc.target.clone() : new Vector3();
      const dir = camera.position.clone().sub(from).normalize();
      camera.position.copy(t).addScaledVector(dir, 320);
      if (oc) {
        oc.target.copy(t);
        oc.update();
      } else camera.lookAt(t);
    };
    viewportBus.fit = () => {
      const st = useCadStore.getState();
      const b = robotBounds(st.instances, st.catalog);
      const c = b.isEmpty() ? new Vector3(0, 60, 0) : b.getCenter(new Vector3());
      const r = b.isEmpty() ? 300 : Math.max(120, b.getSize(new Vector3()).length() * 0.8);
      const dir = new Vector3(1, 0.75, 1.25).normalize();
      camera.position.copy(c).addScaledVector(dir, r * 1.6);
      const oc = controls as unknown as OrbitControlsImpl | null;
      if (oc) {
        oc.target.copy(c);
        oc.update();
      } else camera.lookAt(c);
    };
  }, [camera, controls, gl]);
  return null;
}

export function Viewport() {
  const theme = useCadStore((s) => s.theme);
  const dark = theme === 'dark';
  const paused = useCadStore((s) => s.modal === 'test');
  return (
    <Canvas
      frameloop={paused ? 'never' : 'always'}
      data-testid="viewport"
      camera={{ position: [420, 340, 560], fov: 40, near: 1, far: 40000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      onCreated={({ gl }) => gl.setClearColor(dark ? '#121316' : '#e9ecf0')}
      style={{ background: 'var(--viewport)' }}
    >
      <color attach="background" args={[dark ? '#121316' : '#e9ecf0']} />
      <hemisphereLight args={[dark ? '#dfe6ff' : '#ffffff', dark ? '#2a2420' : '#b9b2a8', dark ? 1.1 : 1.25]} />
      <directionalLight position={[300, 600, 400]} intensity={dark ? 1.6 : 1.4} />
      <directionalLight position={[-400, 250, -300]} intensity={0.55} />
      <ambientLight intensity={0.25} />
      <Grid
        infiniteGrid
        cellSize={8}
        sectionSize={48}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={dark ? '#24262b' : '#d3d7de'}
        sectionColor={dark ? '#3a3e46' : '#b4bac4'}
        fadeDistance={4000}
        fadeStrength={1.6}
        position={[0, -0.05, 0]}
      />
      <PartsLayer />
      <HoverOverlay />
      <Interaction />
      <SelectionGizmo />
      <SizingCube />
      <CoGMarker />
      <CheckOverlay />
      <CameraRig />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxDistance={15000} minDistance={20} />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewcube color={dark ? '#26282d' : '#ffffff'} textColor={dark ? '#e5e7eb' : '#1f2937'} strokeColor={dark ? '#3b3f47' : '#cbd0d8'} hoverColor="#ff6a13" opacity={1} />
      </GizmoHelper>
    </Canvas>
  );
}
