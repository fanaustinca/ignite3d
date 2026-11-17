import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewcube, Grid, Html, OrbitControls, TransformControls } from '@react-three/drei';
import {
  Box3,
  BoxGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  InstancedMesh,
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
import { useCadStore } from '../store/useCadStore';
import type { CatalogPart, PlacedInstance, Quat, SnapPoint, Vec3 } from '../types/cad';
import { useVisual } from '../services/visuals';
import { visualFor } from '../services/assetLoader';
import { compatible, instanceMatrix, mateTransform, q4, SNAP_COLORS, toQuat, toVec3, v3, worldSnaps, type WorldSnap } from '../lib/snap';
import { massProps, robotBounds, sizeCheck, SIZE_LIMIT_MM } from '../lib/metrics';

// ------------------------------------------------------------------ shared registries

const pickables = new Set<Object3D>();
export const viewportBus = {
  fit: () => {},
  /** World (mm) -> client pixel coordinates. */
  project: (_p: Vec3) => ({ x: 0, y: 0 }),
  setView: (_pos: Vec3, _target: Vec3) => {},
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
  if (!inst || !visual || placing || selected) return null;
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
      if (i.hidden) continue;
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
    </group>
  );
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

/** Which of the 4 quarter-turns about the mating axis aligns the most hole faces with the target part. */
function bestAlignment(anchor: SnapPoint, target: WorldSnap, part: CatalogPart, targetSnaps: WorldSnap[]) {
  const hash = new Set(targetSnaps.map((s) => `${Math.round(s.pos.x * 4)},${Math.round(s.pos.y * 4)},${Math.round(s.pos.z * 4)}`));
  let best = 0;
  let bestN = -1;
  for (let k = 0; k < 4; k++) {
    const m = mateTransform(anchor, target, (k * Math.PI) / 2);
    let n = 0;
    const v = new Vector3();
    for (const s of part.snapPoints) {
      v.set(...s.position).applyQuaternion(m.quaternion).add(m.position);
      if (hash.has(`${Math.round(v.x * 4)},${Math.round(v.y * 4)},${Math.round(v.z * 4)}`)) n++;
    }
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
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
  const ghostState = useRef<{ position: Vector3; quaternion: Quaternion; target: WorldSnap | null; anchor: SnapPoint | null; valid: boolean }>({
    position: new Vector3(),
    quaternion: new Quaternion(),
    target: null,
    anchor: null,
    valid: false,
  });
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
        else if (st.tool === 'fasten') st.set({ tool: 'select' });
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
      gl.domElement.style.cursor = best ? 'crosshair' : 'default';
      return;
    }
    fastenTarget.current = null;

    // ---------- placing (read from the store, not React state, so the first mouse move after
    // picking a part is never lost to a render that has not committed yet)
    const g = ghostRef.current;
    const ghostPart = st.placingSku ? st.catalog[st.placingSku] : null;
    if (!st.placingSku || !ghostPart || !g) {
      setMarkers([]);
      showTarget(null);
      if (g) g.visible = false;
      gl.domElement.style.cursor = hovered ? 'pointer' : 'default';
      return;
    }
    gl.domElement.style.cursor = 'crosshair';
    const gs = ghostState.current;
    gs.target = null;
    gs.anchor = null;
    gs.valid = !!hit;
    if (!hit) {
      g.visible = false;
      setMarkers([]);
      showTarget(null);
      return;
    }
    g.visible = true;
    let snapped = false;
    const anchors = anchorsFor(ghostPart);
    if (st.snapEnabled && hovInst) {
      const cands = faceSnaps((s) => anchors.some((a) => compatible(a, s.snap)));
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
    if (st.placingSku) {
      const gs = ghostState.current;
      if (!gs.valid) return;
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
    });
    void scene;
  });

  return (
    <>
      <group ref={ghostRef} visible={false}>
        {ghostVisual?.meshes.map((m, k) => <mesh key={k} geometry={m.geometry} material={ghostMats[k]} raycast={() => null} />)}
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

  if (!sel.length || placing || tool !== 'select') return <group ref={pivot} />;
  return (
    <>
      <group ref={pivot} />
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
  return (
    <Canvas
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
      <CameraRig />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxDistance={15000} minDistance={20} />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewcube color={dark ? '#26282d' : '#ffffff'} textColor={dark ? '#e5e7eb' : '#1f2937'} strokeColor={dark ? '#3b3f47' : '#cbd0d8'} hoverColor="#ff6a13" opacity={1} />
      </GizmoHelper>
    </Canvas>
  );
}
