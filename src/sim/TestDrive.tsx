// Live Test (beta): drive the robot you built, run its intake / arms / servos, and push POLLEN and NECTAR
// around a few field tiles. Lazy-loaded (Rapier is only downloaded when this opens).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Gamepad2, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { ensureMeshes, meshOf } from '../services/robotCheck';
import { peekVisual, visualFor } from '../services/assetLoader';
import { instanceMatrix } from '../lib/snap';
import { buildRig, isHardware, type Actuator, type Rig, type RoleOverride } from '../lib/drive/rig';
import { chainKind, chainLinkMatrices, linkGeometry } from '../lib/chain';
import { ELEMENTS, FIELD_TILES, HALF, loadRapier, MM, Sim, TILE, type Commands, type ElementKind, type Telemetry } from './engine';
import { Btn } from '../components/ui';

const KEY_PAIRS: [string, string][] = [
  ['1', '2'],
  ['3', '4'],
  ['5', '6'],
  ['7', '8'],
  ['9', '0'],
  ['r', 'f'],
  ['t', 'g'],
  ['y', 'h'],
  ['u', 'j'],
  ['i', 'k'],
];
const PAD_LABELS = ['RT / LT', 'D-pad ↑ / ↓', 'RB / LB', 'Y / A', 'X / B'];

type Status = { phase: 'loading' | 'ready' | 'error'; msg: string };

// what the user said each motor is (kept per motor in this browser, so a fix sticks between runs)
const ROLE_KEY = 'ignite3d-sim-roles';
function loadRoles(): Record<string, RoleOverride> {
  try {
    return JSON.parse(localStorage.getItem(ROLE_KEY) ?? '{}') as Record<string, RoleOverride>;
  } catch {
    return {};
  }
}
function saveRoles(r: Record<string, RoleOverride>) {
  try {
    localStorage.setItem(ROLE_KEY, JSON.stringify(r));
  } catch {
    /* private mode */
  }
}

export default function TestDrive() {
  const close = () => useCadStore.getState().set({ modal: null });
  const host = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const [status, setStatus] = useState<Status>({ phase: 'loading', msg: 'Loading parts…' });
  const [rig, setRig] = useState<Rig | null>(null);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [follow, setFollow] = useState(true);
  const [toggles, setToggles] = useState<Record<number, number>>({}); // spinner on/off state per actuator
  const [frontYaw, setFrontYaw] = useState(0);
  const [pad, setPad] = useState(false);
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;
  const followRef = useRef(follow);
  followRef.current = follow;
  const spawnRef = useRef<(k: ElementKind, n: number) => void>(() => {});
  const [roles, setRoles] = useState<Record<string, RoleOverride>>(loadRoles);
  const setRole = (id: string, role: RoleOverride | null) =>
    setRoles((cur) => {
      const next = { ...cur };
      if (role) next[id] = role;
      else delete next[id];
      saveRoles(next);
      return next;
    });
  const rolesKey = JSON.stringify(roles);

  // mechanisms the user controls (not the drivetrain)
  const controls = useMemo(() => (rig ? rig.actuators.filter((a) => a.role === 'spinner' || a.role === 'arm') : []), [rig]);
  const controlsRef = useRef<Actuator[]>([]);
  controlsRef.current = controls;

  useEffect(() => {
    if (simRef.current) simRef.current.frontYaw = frontYaw;
  }, [frontYaw]);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const cleanup: (() => void)[] = [];
    (async () => {
      try {
        const st = useCadStore.getState();
        const insts = st.instances.filter((i) => !i.hidden && !i.ghosted);
        if (!insts.length) throw new Error('Build a robot first — the scene is empty.');
        await ensureMeshes(insts.map((i) => i.sku));
        if (disposed) return;
        setStatus({ phase: 'loading', msg: 'Finding motors, gears and wheels…' });
        const catalog = useCadStore.getState().catalog;
        const r = buildRig(insts, catalog, { roles: JSON.parse(rolesKey) as Record<string, RoleOverride> });
        setStatus({ phase: 'loading', msg: 'Starting physics…' });
        const RAPIER = await loadRapier();
        if (disposed) return;
        const sim = new Sim(RAPIER, r, catalog, (p) => meshOf(p));
        simRef.current = sim;
        setFrontYaw(sim.frontYaw);
        setRig(r);

        // ---------------------------------------------------------- three.js scene
        const el = host.current!;
        const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.shadowMap.enabled = true;
        el.appendChild(renderer.domElement);
        renderer.domElement.dataset.testid = 'sim-canvas';
        const scene = new Scene();
        scene.background = new Color(0x1b1d22);
        const cam = new PerspectiveCamera(45, 1, 0.01, 50);
        cam.position.set(0, 1.6, -2.2);
        const orbit = new OrbitControls(cam, renderer.domElement);
        orbit.target.set(0, 0.1, 0);
        orbit.enableDamping = true;
        orbit.maxPolarAngle = Math.PI * 0.49;
        scene.add(new HemisphereLight(0xffffff, 0x404048, 1.1), new AmbientLight(0xffffff, 0.25));
        const sun = new DirectionalLight(0xffffff, 2.2);
        sun.position.set(1.5, 3, 1);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.left = sc.bottom = -HALF - 0.3;
        sc.right = sc.top = HALF + 0.3;
        scene.add(sun);

        // tiles (grey foam with seams) + walls
        const tex = tileTexture();
        tex.wrapS = tex.wrapT = RepeatWrapping;
        tex.repeat.set(FIELD_TILES, FIELD_TILES);
        const floor = new Mesh(new PlaneGeometry(FIELD_TILES * TILE, FIELD_TILES * TILE), new MeshStandardMaterial({ map: tex, roughness: 0.95 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);
        const wallMat = new MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.35, roughness: 0.2 });
        const railMat = new MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 });
        for (const [x, z, sx, sz] of [
          [0, HALF + 0.012, 2 * HALF + 0.05, 0.025],
          [0, -HALF - 0.012, 2 * HALF + 0.05, 0.025],
          [HALF + 0.012, 0, 0.025, 2 * HALF],
          [-HALF - 0.012, 0, 0.025, 2 * HALF],
        ]) {
          const w = new Mesh(new BoxGeometry(sx, 0.31, sz), wallMat);
          w.position.set(x, 0.155, z);
          scene.add(w);
          const rail = new Mesh(new BoxGeometry(sx + 0.01, 0.02, sz + 0.01), railMat);
          rail.position.set(x, 0.31, z);
          scene.add(rail);
        }

        // robot: one Three group per rig body (parts in CAD mm, group carries the body's world pose)
        const groups = new Map<number, Group>();
        for (const b of r.bodies) {
          if (!b.parts.length) continue;
          const g = new Group();
          g.matrixAutoUpdate = false;
          for (const p of b.parts) {
            const v = peekVisual(p.sku) ?? visualFor(p.part);
            const m = instanceMatrix(p.inst);
            for (const { geometry, material } of v.meshes) {
              const mesh = new Mesh(geometry, material);
              mesh.matrixAutoUpdate = false;
              mesh.matrix.copy(m);
              mesh.castShadow = !isHardware(p.part);
              g.add(mesh);
            }
          }
          scene.add(g);
          groups.set(b.id, g);
        }
        const S = new Matrix4().makeScale(MM, MM, MM);
        // chains: links ride round the sprockets as they turn
        const linkGeo = linkGeometry();
        const chainMeshes = r.chains.map((c) => {
          const mesh = new InstancedMesh(linkGeo, new MeshStandardMaterial({ color: chainKind(c.rc.chain.sku).color, metalness: 0.35, roughness: 0.5 }), c.rc.links);
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          scene.add(mesh);
          return { c, mesh };
        });
        const syncChains = (cm: Matrix4) => {
          for (const { c, mesh } of chainMeshes) {
            // the frame the sprocket axles are fixed in, and how far the chain has moved (sprocket angle × radius)
            const ba = r.bodies[c.a], bb = r.bodies[c.b];
            const lead = sim.moving.get(c.a) ? ba : sim.moving.get(c.b) ? bb : null;
            const frame = sim.bodyWorld(lead?.parent ?? ba.parent ?? sim.chassisId, cm).clone().multiply(S);
            let phase = 0;
            if (lead) {
              const m = sim.moving.get(lead.id)!;
              const sp = lead === ba ? c.rc.a : c.rc.b;
              phase = m.angle * sp.r * (Math.sign(m.axis.dot(sp.d)) || 1) * (lead === ba ? 1 : Math.sign(c.rc.a.d.dot(c.rc.b.d)) || 1);
            }
            chainLinkMatrices(c.rc, phase, frame).forEach((m, i) => mesh.setMatrixAt(i, m));
            mesh.instanceMatrix.needsUpdate = true;
          }
        };

        // game elements
        const ballGeo = { pollen: new SphereGeometry(ELEMENTS.pollen.r, 22, 14), nectar: new SphereGeometry(ELEMENTS.nectar.r, 24, 16) };
        const ballMat = {
          pollen: new MeshStandardMaterial({ color: ELEMENTS.pollen.color, roughness: 0.55 }),
          nectarRed: new MeshStandardMaterial({ color: 0xd8262c, roughness: 0.5 }),
          nectarBlue: new MeshStandardMaterial({ color: 0x2459d6, roughness: 0.5 }),
        };
        const balls = new Map<number, Mesh>();
        const syncBalls = () => {
          for (const e of sim.elements)
            if (!balls.has(e.id)) {
              const m = new Mesh(e.kind === 'pollen' ? ballGeo.pollen : ballGeo.nectar, ballMat[e.kind]);
              m.castShadow = true;
              scene.add(m);
              balls.set(e.id, m);
            }
          for (const [id, m] of balls)
            if (!sim.elements.some((e) => e.id === id)) {
              scene.remove(m);
              balls.delete(id);
            }
        };
        spawnRef.current = (k, n) => {
          for (let i = 0; i < n; i++) sim.addElement(k);
          syncBalls();
        };
        // a starter set in front of the robot
        for (let i = 0; i < 8; i++) sim.addElement('pollen');
        sim.addElement('nectarRed');
        sim.addElement('nectarBlue');
        syncBalls();

        // click the floor to drop a POLLEN there (Shift = NECTAR)
        const ray = new Raycaster();
        const onClick = (e: MouseEvent) => {
          if (!e.altKey) return;
          const rect = renderer.domElement.getBoundingClientRect();
          ray.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), cam);
          const hit = ray.intersectObject(floor)[0];
          if (!hit) return;
          sim.addElement(e.shiftKey ? 'nectarRed' : 'pollen', new Vector3(hit.point.x, 0.25, hit.point.z));
          syncBalls();
        };
        renderer.domElement.addEventListener('click', onClick);

        // ---------------------------------------------------------- input
        const keys = new Set<string>();
        const onDown = (e: KeyboardEvent) => {
          const t = e.target as HTMLElement;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
          const k = e.key.toLowerCase();
          if (k === 'escape') return;
          keys.add(k);
          if (e.repeat) return;
          // spinners toggle: first key = forward on/off, second = reverse on/off
          controlsRef.current.forEach((a, i) => {
            const pair = KEY_PAIRS[i];
            if (!pair || a.role !== 'spinner') return;
            if (k === pair[0]) setToggles((s) => ({ ...s, [a.id]: s[a.id] === 1 ? 0 : 1 }));
            if (k === pair[1]) setToggles((s) => ({ ...s, [a.id]: s[a.id] === -1 ? 0 : -1 }));
          });
          if (k === 'backspace') sim.resetRobot();
          if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
        };
        const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
        const onBlur = () => keys.clear();
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup', onUp);
        window.addEventListener('blur', onBlur);

        const dz = (x: number) => (Math.abs(x) < 0.12 ? 0 : (x - Math.sign(x) * 0.12) / 0.88);
        const read = (): Commands => {
          const has = (...k: string[]) => k.some((x) => keys.has(x));
          let fwd = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0);
          let strafe = (has('d') ? 1 : 0) - (has('a') ? 1 : 0);
          let turn = (has('e', 'arrowright') ? 1 : 0) - (has('q', 'arrowleft') ? 1 : 0);
          const slow = keys.has('shift') ? 0.4 : 1;
          const act: Record<number, number> = {};
          const gp = navigator.getGamepads?.().find((g) => g && g.connected);
          if (gp) {
            fwd += -dz(gp.axes[1] ?? 0);
            strafe += dz(gp.axes[0] ?? 0);
            turn += dz(gp.axes[2] ?? 0);
          }
          controlsRef.current.forEach((a, i) => {
            const pair = KEY_PAIRS[i];
            let u = 0;
            if (a.role === 'spinner') u = (togglesRef.current[a.id] ?? 0) * (sim.inSign[a.id] ?? 1);
            else if (pair) u = (keys.has(pair[0]) ? 1 : 0) - (keys.has(pair[1]) ? 1 : 0);
            if (gp) {
              const b = (n: number) => gp.buttons[n]?.value ?? 0;
              const padU = [b(7) - b(6), b(12) - b(13), b(5) - b(4), b(3) - b(0), b(2) - b(1)][i] ?? 0;
              if (Math.abs(padU) > 0.1) u = a.role === 'spinner' ? padU * (sim.inSign[a.id] ?? 1) : padU;
            }
            act[a.id] = Math.max(-1, Math.min(1, u)) * (a.role === 'arm' ? 0.6 * slow : 1);
          });
          const c = (x: number) => Math.max(-1, Math.min(1, x)) * slow;
          return { fwd: c(fwd), strafe: c(strafe), turn: c(turn) * 0.8, act };
        };

        // ---------------------------------------------------------- loop
        const resize = () => {
          const w = el.clientWidth, h = el.clientHeight;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
          cam.aspect = w / Math.max(1, h);
          cam.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        let last = performance.now();
        let acc = 0;
        let teleT = 0;
        const prevChassis = new Vector3();
        const cm = new Matrix4();
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const now = performance.now();
          acc += Math.min(0.1, (now - last) / 1000);
          last = now;
          const cmd = read();
          let steps = 0;
          while (acc >= 1 / 120 && steps < 6) {
            sim.step(cmd, 1 / 120);
            acc -= 1 / 120;
            steps++;
          }
          if (steps === 6) acc = 0;
          setPad(!!navigator.getGamepads?.().some((g) => g && g.connected));
          if (balls.size !== sim.elements.length) syncBalls();
          // poses
          sim.chassisMatrix(cm);
          for (const [id, g] of groups) {
            g.matrix.copy(sim.bodyWorld(id, cm)).multiply(S);
            g.matrixWorldNeedsUpdate = true;
          }
          syncChains(cm);
          for (const e of sim.elements) {
            const m = balls.get(e.id);
            if (!m) continue;
            const p = e.body.translation(), q = e.body.rotation();
            m.position.set(p.x, p.y, p.z);
            m.quaternion.set(q.x, q.y, q.z, q.w);
          }
          // follow camera: move the orbit target (and camera) with the robot
          const c = sim.com.clone().applyMatrix4(cm);
          if (followRef.current) {
            const d = c.clone().sub(prevChassis);
            if (prevChassis.lengthSq() > 0) {
              cam.position.add(d);
              orbit.target.add(d);
            } else orbit.target.copy(c);
          }
          prevChassis.copy(c);
          orbit.update();
          renderer.render(scene, cam);
          if (now - teleT > 120) {
            teleT = now;
            setTele(sim.telemetry());
          }
        };
        // first frame: frame the robot
        const c0 = sim.com.clone().applyMatrix4(sim.chassisMatrix());
        orbit.target.copy(c0);
        cam.position.copy(c0).add(new Vector3(0.0, 0.75, -1.1));
        prevChassis.copy(c0);
        raf = requestAnimationFrame(tick);
        setStatus({ phase: 'ready', msg: '' });
        (window as unknown as { __igniteSim?: unknown }).__igniteSim = { sim, rig: r, keys, read };

        cleanup.push(() => {
          ro.disconnect();
          window.removeEventListener('keydown', onDown);
          window.removeEventListener('keyup', onUp);
          window.removeEventListener('blur', onBlur);
          renderer.domElement.removeEventListener('click', onClick);
          orbit.dispose();
          renderer.dispose();
          renderer.domElement.remove();
          tex.dispose();
          sim.dispose();
          delete (window as unknown as { __igniteSim?: unknown }).__igniteSim;
        });
      } catch (e) {
        console.error(e);
        if (!disposed) setStatus({ phase: 'error', msg: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      simRef.current = null;
    };
  }, [rolesKey]);

  const driveLabel = rig ? { mecanum: 'Mecanum', tank: 'Tank / differential', omni: 'Omni', 'x-drive': 'X-drive', 'swerve?': 'Swerve', none: 'No drivetrain found' }[rig.drive.kind] : '';
  const canStrafe = rig && ['mecanum', 'omni', 'x-drive'].includes(rig.drive.kind);

  return (
    <div data-testid="sim" className="dark fixed inset-0 z-50 flex bg-[#1b1d22] text-[13px] text-white">
      <div ref={host} className="relative min-w-0 flex-1" data-testid="sim-view">
        {status.phase !== 'ready' && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex max-w-md flex-col items-center gap-3 text-center" data-testid="sim-status">
              {status.phase === 'loading' ? <Loader2 className="animate-spin text-accent" size={28} /> : <X className="text-red-400" size={28} />}
              <div className={status.phase === 'error' ? 'text-red-300' : 'text-white/80'}>{status.msg}</div>
              {status.phase === 'error' && <Btn onClick={close}>Back to CAD</Btn>}
            </div>
          </div>
        )}
        {status.phase === 'ready' && tele && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/55 px-3 py-2 font-mono text-[12px] leading-5 num" data-testid="sim-tele">
            <div>{(tele.speed / 0.0254 / 12).toFixed(1)} ft/s · heading {tele.heading.toFixed(0)}°</div>
            {tele.tipped && <div className="text-red-300">Tipped over — press Backspace to reset</div>}
          </div>
        )}
      </div>

      <aside className="flex w-[330px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#202329] p-4" data-testid="sim-panel">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              Live Test <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide">BETA</span>
            </div>
            <div className="text-[11.5px] text-white/55">Drive your robot and try its mechanisms.</div>
          </div>
          <Btn tone="ghost" aria-label="Close Live Test" data-testid="sim-close" onClick={close}>
            <X size={16} />
          </Btn>
        </div>

        {rig && (
          <>
            <section className="rounded-lg bg-white/5 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Drive</span>
                <span className="text-[12px]" data-testid="sim-drive-kind">
                  {driveLabel}
                  {rig.drive.motors ? ` · ${rig.drive.motors} motor${rig.drive.motors > 1 ? 's' : ''}` : ''}
                </span>
              </div>
              {rig.drive.motors > 0 ? (
                <ul className="space-y-0.5 text-[12px] text-white/75">
                  <li>
                    <Kbd>W</Kbd>
                    <Kbd>S</Kbd> forward / back · <Kbd>Q</Kbd>
                    <Kbd>E</Kbd> turn
                  </li>
                  <li className={canStrafe ? '' : 'text-white/35'}>
                    <Kbd>A</Kbd>
                    <Kbd>D</Kbd> strafe{canStrafe ? '' : ' (this drivetrain can’t)'}
                  </li>
                  <li>
                    <Kbd>Shift</Kbd> slow · <Kbd>⌫</Kbd> reset robot
                  </li>
                </ul>
              ) : (
                <p className="text-[12px] text-amber-200">No powered wheels on the floor yet.</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Btn data-testid="sim-front" onClick={() => setFrontYaw((y) => (y + Math.PI / 2) % (2 * Math.PI))} title="Change which side of the robot is the front">
                  Front ↻ {(((Math.round((frontYaw * 180) / Math.PI) % 360) + 360) % 360)}°
                </Btn>
                <Btn active={follow} onClick={() => setFollow((f) => !f)}>
                  Follow cam
                </Btn>
                <Btn onClick={() => simRef.current?.resetRobot()}>
                  <RotateCcw size={13} /> Reset
                </Btn>
              </div>
              {tele && rig.drive.motors > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-white/60 num">
                  {rig.actuators
                    .filter((a) => a.role === 'drive')
                    .map((a) => (
                      <Meter key={a.id} label={simRef.current?.driveLabel(a.id) ?? a.label.replace('Drive ', '')} v={tele.motors[a.id] ?? 0} />
                    ))}
                </div>
              )}
            </section>

            <section className="rounded-lg bg-white/5 p-3" data-testid="sim-mechanisms">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">Mechanisms</div>
              {controls.length ? (
                <ul className="space-y-2">
                  {controls.map((a, i) => {
                    const pair = KEY_PAIRS[i];
                    const on = toggles[a.id] ?? 0;
                    return (
                      <li key={a.id} className="flex items-center gap-2" data-testid="sim-mech" data-role={a.role}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{a.label}</div>
                          <div className="truncate text-[11px] text-white/45" title={a.name}>
                            {a.role === 'spinner' ? 'toggle' : 'hold'} {pair ? <><Kbd>{pair[0].toUpperCase()}</Kbd><Kbd>{pair[1].toUpperCase()}</Kbd></> : null}
                            {pad && PAD_LABELS[i] ? ` · pad ${PAD_LABELS[i]}` : ''}
                            {a.role === 'arm' && tele?.angles[a.id] !== undefined ? ` · ${tele.angles[a.id].toFixed(0)}°` : ''}
                            {tele?.stopped[a.id] ? <span className="text-amber-300" data-testid="sim-stop"> · hard stop</span> : ''}
                          </div>
                        </div>
                        {a.role === 'spinner' && (
                          <div className="flex gap-1">
                            <Btn active={on === 1} data-testid="sim-spin-in" onClick={() => setToggles((s) => ({ ...s, [a.id]: on === 1 ? 0 : 1 }))}>
                              In
                            </Btn>
                            <Btn active={on === -1} onClick={() => setToggles((s) => ({ ...s, [a.id]: on === -1 ? 0 : -1 }))}>
                              Out
                            </Btn>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[12px] text-white/50">No motor or servo drives anything besides the wheels.</p>
              )}
            </section>

            {rig.actuators.length > 0 && (
              <details className="rounded-lg bg-white/5 p-3" data-testid="sim-roles" open={Object.keys(roles).length > 0}>
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-white/50">Motor roles {Object.keys(roles).length ? `· ${Object.keys(roles).length} set by you` : '· auto'}</summary>
                <p className="mt-1.5 text-[11px] text-white/45">Guessed wrong? Tell it what each motor does.</p>
                <ul className="mt-1.5 space-y-1.5">
                  {rig.actuators.map((a) => {
                    const own = roles[a.instanceId];
                    const short = a.label.replace(/ \(nothing attached\)/, '');
                    return (
                      <li key={a.instanceId} className="flex items-center gap-2 text-[12px]">
                        <span className="min-w-0 flex-1 truncate" title={a.name}>
                          {short}
                        </span>
                        <select
                          data-testid="sim-role"
                          aria-label={`What ${short} does`}
                          className="rounded border border-white/15 bg-[#2a2e35] px-1 py-0.5 text-[11.5px]"
                          value={own ?? 'auto'}
                          onChange={(e) => setRole(a.instanceId, e.target.value === 'auto' ? null : (e.target.value as RoleOverride))}
                        >
                          <option value="auto">Auto ({a.role === 'spinner' ? 'intake' : a.role === 'idle' ? 'nothing' : a.role})</option>
                          <option value="spinner">Intake / spinner</option>
                          <option value="arm">Arm / pivot</option>
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}

            <section className="rounded-lg bg-white/5 p-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">Game elements</div>
              <div className="flex flex-wrap gap-1.5">
                <Btn data-testid="sim-add-pollen" onClick={() => spawnRef.current('pollen', 5)}>
                  <Dot c="#f2cf1d" /> +5 Pollen
                </Btn>
                <Btn data-testid="sim-add-nectar" onClick={() => spawnRef.current('nectarRed', 1)}>
                  <Dot c="#d8262c" /> Nectar
                </Btn>
                <Btn onClick={() => spawnRef.current('nectarBlue', 1)}>
                  <Dot c="#2459d6" /> Nectar
                </Btn>
                <Btn
                  tone="ghost"
                  onClick={() => {
                    simRef.current?.removeElements();
                    spawnRef.current('pollen', 0);
                  }}
                >
                  <Trash2 size={13} /> Clear
                </Btn>
              </div>
              <p className="mt-1.5 text-[11px] text-white/45">Alt-click the floor to drop a POLLEN (Alt+Shift: NECTAR). Soft gecko / intake wheels squish and grip; POLLEN and NECTAR squish a little too.</p>
            </section>

            {rig.notes.length > 0 && (
              <section className="rounded-lg bg-amber-400/10 p-3 text-[12px] text-amber-100" data-testid="sim-notes">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200/70">What the beta noticed</div>
                <ul className="list-disc space-y-1 pl-4">
                  {rig.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-white/40">
              <Gamepad2 size={13} /> {pad ? 'Gamepad connected: left stick drives, right stick turns.' : 'Plug in a gamepad to drive with sticks.'} Esc exits.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="mx-0.5 inline-block min-w-[18px] rounded border border-white/20 bg-white/10 px-1 text-center font-mono text-[10.5px] leading-[16px]">{children}</kbd>;
}
function Dot({ c }: { c: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />;
}
function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[70px] truncate">{label}</span>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded bg-white/10">
        <span className={`absolute top-0 h-full ${v >= 0 ? 'left-1/2 bg-accent' : 'right-1/2 bg-sky-400'}`} style={{ width: `${Math.min(50, Math.abs(v) * 50)}%` }} />
      </span>
    </div>
  );
}

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b5f66';
  g.fillRect(0, 0, 256, 256);
  // foam speckle
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},0.04)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // interlocking edge
  g.strokeStyle = '#3d4046';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 256; i += 32) {
    g.moveTo(i, 0);
    g.lineTo(i, 5);
  }
  g.stroke();
  g.strokeRect(1, 1, 254, 254);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
