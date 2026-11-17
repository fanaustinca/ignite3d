import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Box3, BufferGeometry, DoubleSide, Group, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Raycaster, TorusGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { strToU8, zipSync } from 'fflate';
import { Download, Github, Save, Stamp, Target, Trash2, Upload } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import type { CatalogPart, SnapPoint, SnapType, Vec3 } from '../types/cad';
import { anyPerp, SNAP_COLORS, toVec3 } from '../lib/snap';
import { saveCustomPart } from '../services/customParts';
import { setVisual } from '../services/assetLoader';
import { download } from '../export/files';
import { dracoBase } from '../config/assets';
import { Btn, Modal } from './ui';

type Baked = { geometry: BufferGeometry; material: Material }[];
type HoleKind = 'auto' | SnapType;

const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

async function parseFile(file: File, dracoPath: string): Promise<Baked> {
  const buf = await file.arrayBuffer();
  const out: Baked = [];
  if (/\.stl$/i.test(file.name)) {
    const g = new STLLoader().parse(buf);
    g.computeVertexNormals();
    out.push({ geometry: g, material: new MeshStandardMaterial({ color: '#b9a1f5', metalness: 0.1, roughness: 0.6 }) });
    return out;
  }
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(dracoPath);
  loader.setDRACOLoader(draco);
  const gltf = await loader.parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    out.push({ geometry: g, material: Array.isArray(m.material) ? m.material[0] : m.material });
  });
  if (!out.length) throw new Error('No meshes in file');
  return out;
}

function classify(d: number): SnapType {
  if (d < 5.2) return 'm4_hole';
  if (d < 7.2) return 'd_6mm';
  if (d < 10) return 'rex_8mm';
  return 'bearing_14mm';
}

/** RANSAC circle fit on in-plane vertices near the click: returns hole centre + diameter. */
function findHole(meshes: Baked, p: Vector3, n: Vector3): { center: Vector3; d: number } | null {
  const u = anyPerp(n);
  const w = new Vector3().crossVectors(n, u);
  const pts: [number, number][] = [];
  const v = new Vector3();
  for (const { geometry } of meshes) {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(p);
      if (Math.abs(v.dot(n)) > 0.35) continue;
      const a = v.dot(u);
      const b = v.dot(w);
      if (a * a + b * b > 15 * 15) continue;
      pts.push([a, b]);
    }
  }
  const uniq = [...new Map(pts.map((q) => [`${q[0].toFixed(3)},${q[1].toFixed(3)}`, q])).values()];
  if (uniq.length < 5) return null;
  let best: { cx: number; cy: number; r: number; score: number } | null = null;
  const N = uniq.length;
  for (let it = 0; it < 900; it++) {
    const A = uniq[(Math.random() * N) | 0], B = uniq[(Math.random() * N) | 0], C = uniq[(Math.random() * N) | 0];
    const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    if (Math.abs(d) < 1e-6) continue;
    const a2 = A[0] ** 2 + A[1] ** 2, b2 = B[0] ** 2 + B[1] ** 2, c2 = C[0] ** 2 + C[1] ** 2;
    const cx = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d;
    const cy = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d;
    const r = Math.hypot(A[0] - cx, A[1] - cy);
    if (r < 1.5 || r > 9) continue;
    let inl = 0;
    for (const q of uniq) if (Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - r) < 0.12) inl++;
    if (inl < 6) continue;
    const score = inl - Math.hypot(cx, cy) * 0.05;
    if (!best || score > best.score) best = { cx, cy, r, score };
  }
  if (!best) return null;
  return { center: p.clone().addScaledVector(u, best.cx).addScaledVector(w, best.cy), d: best.r * 2 };
}

function thicknessAt(meshes: Baked, p: Vector3, n: Vector3) {
  const rc = new Raycaster(p.clone().addScaledVector(n, -0.02), n.clone().negate(), 0, 60);
  const probe = new MeshBasicMaterial({ side: DoubleSide });
  const objs = meshes.map((m) => new Mesh(m.geometry, probe));
  const h = rc.intersectObjects(objs, false)[0];
  return h ? h.distance + 0.02 : 0;
}

const ringGeo = new TorusGeometry(2.6, 0.5, 6, 20);

export function UploadStudio() {
  const st = useCadStore();
  const [meshes, setMeshes] = useState<Baked | null>(null);
  const [raw, setRaw] = useState<Baked | null>(null);
  const [fileName, setFileName] = useState('');
  const [unit, setUnit] = useState('mm');
  const [center, setCenter] = useState(true);
  const [holes, setHoles] = useState<SnapPoint[]>([]);
  const [mode, setMode] = useState<'hole' | 'stamp'>('hole');
  const [kind, setKind] = useState<HoleKind>('auto');
  const [auto, setAuto] = useState(true);
  const [through, setThrough] = useState(true);
  const [meta, setMeta] = useState({ sku: `9000-${String(Math.floor(Math.random() * 9000) + 1000)}-0001`, name: '', mass: 25, price: 0 });
  const [err, setErr] = useState('');
  const counter = useRef(0);

  const bake = (src: Baked, u: string, c: boolean) => {
    const s = UNITS[u];
    const scaled = src.map((m) => ({ geometry: m.geometry.clone().applyMatrix4(new Matrix4().makeScale(s, s, s)), material: m.material }));
    if (c) {
      const b = new Box3();
      scaled.forEach((m) => {
        m.geometry.computeBoundingBox();
        b.union(m.geometry.boundingBox!);
      });
      const ctr = b.getCenter(new Vector3());
      scaled.forEach((m) => m.geometry.translate(-ctr.x, -ctr.y, -ctr.z));
    }
    scaled.forEach((m) => {
      m.geometry.computeBoundingBox();
      m.geometry.computeBoundingSphere();
    });
    setMeshes(scaled);
    setHoles([]);
  };

  const bounds = useMemo(() => {
    const b = new Box3();
    meshes?.forEach((m) => b.union(m.geometry.boundingBox!));
    return b;
  }, [meshes]);

  const addHole = (pos: Vector3, n: Vector3, type: SnapType, up: Vector3, t: number) => {
    if (!meshes) return;
    const id = `c${++counter.current}`;
    const list: SnapPoint[] = [{ id: `${id}a`, type, position: toVec3(pos), normal: toVec3(n), upVector: toVec3(up), depth: t || undefined, holeId: id }];
    if (through && t > 0.2 && t < 60)
      list.push({ id: `${id}b`, type, position: toVec3(pos.clone().addScaledVector(n, -t)), normal: toVec3(n.clone().negate()), upVector: toVec3(up), depth: t, holeId: id });
    return list;
  };

  const onMeshClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!meshes || !e.face) return;
    tagAt(e.point.clone(), e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize());
  };

  const tagAt = (point: Vector3, n: Vector3) => {
    if (!meshes) return;
    // measure plate thickness at the clicked point (on material, not in the hole)
    const t = through ? thicknessAt(meshes, point, n) : 0;
    let p = point;
    let type: SnapType = kind === 'auto' ? 'm4_hole' : kind;
    if (auto) {
      const h = findHole(meshes, p, n);
      if (h) {
        p = h.center;
        if (kind === 'auto') type = classify(h.d);
      } else if (kind === 'auto') st.toast('No round hole found near the click — tagged at the click point as M4.', 'warn');
    }
    const up = anyPerp(n);
    if (mode === 'stamp') {
      const w = new Vector3().crossVectors(n, up);
      const add: SnapPoint[] = [];
      for (const [a, b] of [[-8, -8], [8, -8], [8, 8], [-8, 8]]) add.push(...(addHole(p.clone().addScaledVector(up, a).addScaledVector(w, b), n, 'm4_hole', up, t) ?? []));
      setHoles((h) => [...h, ...add]);
    } else setHoles((h) => [...h, ...(addHole(p, n, type, up, t) ?? [])]);
  };

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__igniteStudio = {
      tag: (p: Vec3, n: Vec3) => tagAt(new Vector3(...p), new Vector3(...n).normalize()),
      holes: () => holes,
      bounds: () => [bounds.min.toArray(), bounds.max.toArray()],
    };
  });

  const buildPart = (): CatalogPart => {
    const size = bounds.getSize(new Vector3());
    return {
      sku: meta.sku.trim(),
      name: meta.name.trim() || fileName.replace(/\.\w+$/, ''),
      category: 'Custom',
      dimensions: [size.x, size.y, size.z].map((x) => Math.round(x * 100) / 100) as Vec3,
      massGrams: Number(meta.mass) || 0,
      priceUsd: Number(meta.price) || 0,
      snapPoints: holes,
      isCustom: true,
    };
  };

  const toGlb = async () => {
    const g = new Group();
    meshes!.forEach((m) => g.add(new Mesh(m.geometry, m.material)));
    return (await new GLTFExporter().parseAsync(g, { binary: true })) as ArrayBuffer;
  };

  const valid = !!meshes && /^[\w-]{4,40}$/.test(meta.sku.trim());

  return (
    <Modal testid="upload-modal" wide title="Custom part · upload & tag holes" onClose={() => st.set({ modal: null })}>
      <div className="grid grid-cols-[1fr_300px] gap-4">
        <div className="relative h-[460px] overflow-hidden rounded-lg border border-line bg-[var(--viewport)]">
          {meshes ? (
            <Canvas
              key={`${fileName}-${unit}-${center}`}
              camera={(() => {
                const r = Math.max(30, bounds.getSize(new Vector3()).length());
                const c = bounds.getCenter(new Vector3());
                return { position: [c.x + r * 0.9, c.y + r * 0.75, c.z + r * 1.05] as [number, number, number], fov: 40, near: 0.5, far: 20000 };
              })()}
            >
              <hemisphereLight args={['#ffffff', '#888', 1.2]} />
              <directionalLight position={[100, 200, 120]} intensity={1.2} />
              <Grid infiniteGrid cellSize={8} sectionSize={48} cellColor="#8884" sectionColor="#8888" fadeDistance={1200} position={[0, bounds.min.y - 0.1, 0]} />
              {meshes.map((m, k) => (
                <mesh key={k} geometry={m.geometry} material={m.material} onClick={onMeshClick} />
              ))}
              {holes.map((h) => (
                <mesh
                  key={h.id}
                  geometry={ringGeo}
                  position={new Vector3(...h.position).addScaledVector(new Vector3(...h.normal), 0.2)}
                  quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...h.normal))}
                  raycast={() => null}
                >
                  <meshBasicMaterial color={SNAP_COLORS[h.type]} toneMapped={false} />
                </mesh>
              ))}
              <OrbitControls makeDefault target={bounds.getCenter(new Vector3())} />
            </Canvas>
          ) : (
            <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-2 text-muted hover:text-accent">
              <Upload size={32} />
              <span className="font-medium">Choose a .glb or .stl file</span>
              <span className="text-[12px]">Everything stays in your browser</span>
              <input
                data-testid="upload-file"
                type="file"
                accept=".glb,.gltf,.stl"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setErr('');
                  try {
                    const parsed = await parseFile(f, dracoBase(st.assetConfig));
                    setRaw(parsed);
                    setFileName(f.name);
                    setMeta((m) => ({ ...m, name: m.name || f.name.replace(/\.\w+$/, '') }));
                    bake(parsed, unit, center);
                  } catch (x) {
                    setErr((x as Error).message);
                  }
                }}
              />
              {err && <span className="text-danger">{err}</span>}
            </label>
          )}
          {meshes && (
            <div className="absolute left-2 top-2 rounded-md bg-panel/90 px-2 py-1 text-[11.5px] text-muted shadow">
              Click a flat face next to a hole{mode === 'stamp' ? ' — stamps a 16 mm 4-hole pattern centred there' : ''}.
            </div>
          )}
        </div>
        <div className="space-y-3 text-[12.5px]">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">File units</span>
              <select className="field" value={unit} onChange={(e) => (setUnit(e.target.value), raw && bake(raw, e.target.value, center))}>
                {Object.keys(UNITS).map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="mt-5 flex items-center gap-1.5">
              <input type="checkbox" checked={center} onChange={(e) => (setCenter(e.target.checked), raw && bake(raw, unit, e.target.checked))} /> Center at origin
            </label>
          </div>
          {meshes && (
            <div className="font-mono text-[11px] text-muted num">
              {bounds.getSize(new Vector3()).toArray().map((x) => x.toFixed(1)).join(' × ')} mm
            </div>
          )}
          <div className="flex gap-1">
            <Btn active={mode === 'hole'} onClick={() => setMode('hole')}>
              <Target size={14} /> Tag hole
            </Btn>
            <Btn active={mode === 'stamp'} onClick={() => setMode('stamp')}>
              <Stamp size={14} /> 16 mm stamp
            </Btn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">Hole type</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as HoleKind)}>
                <option value="auto">Auto (by diameter)</option>
                {Object.keys(SNAP_COLORS).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex flex-col gap-1">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-center
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={through} onChange={(e) => setThrough(e.target.checked)} /> Through hole
              </label>
            </div>
          </div>
          <div className="max-h-28 overflow-y-auto rounded-md border border-line">
            {holes.length === 0 && <div className="p-2 text-muted">No holes tagged yet.</div>}
            {holes.map((h) => (
              <div key={h.id} className="flex items-center justify-between border-b border-line/50 px-2 py-0.5 font-mono text-[10.5px]">
                <span style={{ color: SNAP_COLORS[h.type] }}>{h.type}</span>
                <span className="text-muted num">{h.position.map((x) => x.toFixed(1)).join(',')}</span>
                <button type="button" aria-label="Remove hole" className="text-muted hover:text-danger" onClick={() => setHoles(holes.filter((x) => x.holeId !== h.holeId))}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-0.5">
              <span className="text-muted">Name</span>
              <input className="field" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">SKU</span>
              <input className="field font-mono text-[11.5px]" value={meta.sku} onChange={(e) => setMeta({ ...meta, sku: e.target.value })} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">Mass (g)</span>
              <input className="field" type="number" value={meta.mass} onChange={(e) => setMeta({ ...meta, mass: Number(e.target.value) })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Btn
              tone="accent"
              data-testid="save-custom"
              disabled={!valid}
              onClick={async () => {
                const part = buildPart();
                const glb = await toGlb();
                await saveCustomPart(part, glb);
                const b = new Box3();
                meshes!.forEach((m) => b.union(m.geometry.boundingBox!));
                setVisual(part.sku, { meshes: meshes!, source: 'custom', bounds: b });
                const s = useCadStore.getState();
                s.setCatalog([...Object.values(s.catalog).filter((p) => p.sku !== part.sku), part]);
                s.setAssetStatus(part.sku, 'custom');
                s.toast(`Saved “${part.name}” with ${holes.length} snap points — find it under Custom.`, 'ok');
                s.set({ modal: null });
                s.startPlacing(part.sku);
              }}
            >
              <Save size={14} /> Save to my parts
            </Btn>
            <Btn
              disabled={!valid}
              onClick={async () => {
                const part = buildPart();
                const glb = new Uint8Array(await toGlb());
                const zip = zipSync({ [`parts/${part.sku}.glb`]: glb, [`parts/${part.sku}.json`]: strToU8(JSON.stringify(part, null, 2)) });
                download(`${part.sku}.zip`, zip, 'application/zip');
              }}
            >
              <Download size={14} /> Export bundle
            </Btn>
            <Btn
              disabled={!valid}
              onClick={() => {
                const part = buildPart();
                const { owner, repo } = st.assetConfig.primary;
                const body = `### New part for the catalog\n\n- **SKU:** ${part.sku}\n- **Name:** ${part.name}\n- **Mass:** ${part.massGrams} g\n- **Snap points:** ${part.snapPoints.length}\n\nPlease attach the \`${part.sku}.zip\` bundle from **Export bundle** (contains \`parts/${part.sku}.glb\` + \`.json\`).\n\n<details><summary>catalog entry</summary>\n\n\`\`\`json\n${JSON.stringify({ ...part, snapPoints: part.snapPoints.slice(0, 24) }, null, 1).slice(0, 5000)}\n\`\`\`\n</details>\n`;
                const url = `https://github.com/${owner}/${repo}/issues/new?title=${encodeURIComponent(`New part: ${part.sku} ${part.name}`)}&labels=new-part&body=${encodeURIComponent(body)}`;
                window.open(url, '_blank', 'noopener');
              }}
            >
              <Github size={14} /> Submit to catalog
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
