// Live Test (beta): the rig finds motors -> wheels, and the physics drives / strafes like the real robot.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { CatalogPart, PlacedInstance, SnapPoint } from '../../types/cad';
import { BUILTIN_CATALOG, USING_REAL_CATALOG } from '../../data/catalog';
import { buildExampleRobot } from '../example';
import { buildRig } from './rig';
import { loadRapier, Sim } from '../../sim/engine';

const PARTS = 'public/parts';
const real = USING_REAL_CATALOG && existsSync(`${PARTS}/3625-0202-0104-R.json`);
const cat: Record<string, CatalogPart> = {};
if (real)
  for (const p of BUILTIN_CATALOG) {
    const f = `${PARTS}/${p.sku}.json`;
    cat[p.sku] = existsSync(f) ? { ...p, snapPoints: (JSON.parse(readFileSync(f, 'utf8')) as { snapPoints: SnapPoint[] }).snapPoints } : p;
  }

/** Example drivetrain with its wheels swapped for mecanum: `x` = which corners get the Left wheel. */
function mecanumRobot(leftOn: (x: number, z: number) => boolean): PlacedInstance[] {
  return buildExampleRobot(cat).map((i) => (cat[i.sku].category === 'Wheels' ? { ...i, sku: leftOn(i.position[0], i.position[2]) ? '3625-0202-0104' : '3625-0202-0104-R' } : i));
}

async function drive(list: PlacedInstance[], cmd: { fwd?: number; strafe?: number; turn?: number }, sec = 1) {
  const R = await loadRapier();
  const rig = buildRig(list, cat);
  const sim = new Sim(R, rig, cat, () => null);
  for (let i = 0; i < 60; i++) sim.step({ fwd: 0, strafe: 0, turn: 0, act: {} }, 1 / 120);
  const p0 = sim.chassis.translation();
  const start = { x: p0.x, z: p0.z };
  for (let i = 0; i < sec * 120; i++) sim.step({ fwd: 0, strafe: 0, turn: 0, act: {}, ...cmd }, 1 / 120);
  const p = sim.chassis.translation(), q = sim.chassis.rotation();
  const { fwd, right } = sim.frontAxes();
  const d = { x: p.x - start.x, z: p.z - start.z };
  const out = { rig, along: d.x * fwd.x + d.z * fwd.z, side: d.x * right.x + d.z * right.z, yawDeg: (2 * Math.atan2(q.y, q.w) * 180) / Math.PI, vmax: sim.vmax };
  sim.dispose();
  return out;
}

describe.skipIf(!real)('Live Test rig + physics', () => {
  it('example drivetrain: 4 motors each drive a floor wheel; tank drive goes straight and cannot strafe', async () => {
    const list = buildExampleRobot(cat);
    const rig = buildRig(list, cat);
    expect(rig.drive.kind).toBe('tank');
    expect(rig.drive.motors).toBe(4);
    expect(rig.actuators.every((a) => a.role === 'drive')).toBe(true);
    const f = await drive(list, { fwd: 1 });
    expect(f.along).toBeGreaterThan(0.6);
    expect(Math.abs(f.side)).toBeLessThan(0.05);
    expect(Math.abs(f.yawDeg)).toBeLessThan(3);
    const s = await drive(list, { strafe: 1 });
    expect(Math.abs(s.side)).toBeLessThan(0.05);
    const t = await drive(list, { turn: 1 }, 0.5);
    expect(Math.abs(t.yawDeg)).toBeGreaterThan(30);
  });

  it('mecanum: Left wheels front-left + back-right (X from above) strafe AND turn; the other diagonal cannot turn', async () => {
    const rig0 = buildRig(mecanumRobot(() => true), cat);
    expect(rig0.drive.kind).toBe('mecanum');
    expect(rig0.notes.some((n) => /same hand/.test(n))).toBe(true);
    // forward is +X here (axles along Z, no intake): left = −Z, so front-left / back-right have sign(x)·sign(z) = −1
    const correct = mecanumRobot((x, z) => Math.sign(x) * Math.sign(z) === -1);
    const wrong = mecanumRobot((x, z) => Math.sign(x) * Math.sign(z) === 1);
    const s = await drive(correct, { strafe: 1 });
    expect(Math.abs(s.side)).toBeGreaterThan(0.4);
    expect(Math.abs(s.along)).toBeLessThan(0.1);
    expect(Math.abs(s.yawDeg)).toBeLessThan(5);
    const f = await drive(correct, { fwd: 1 });
    expect(f.along).toBeGreaterThan(0.5);
    const tGood = await drive(correct, { turn: 1 }, 0.5);
    const tBad = await drive(wrong, { turn: 1 }, 0.5);
    expect(Math.abs(tGood.yawDeg)).toBeGreaterThan(40);
    expect(Math.abs(tBad.yawDeg)).toBeLessThan(Math.abs(tGood.yawDeg) / 2); // a rectangular frame keeps a little turning authority
  });
});

describe.skipIf(!real)('Live Test notes', () => {
  it('warns when mecanum wheels are on the wrong corners', () => {
    const wrong = buildRig(mecanumRobot((x, z) => Math.sign(x) * Math.sign(z) === 1), cat);
    const right = buildRig(mecanumRobot((x, z) => Math.sign(x) * Math.sign(z) === -1), cat);
    expect(wrong.notes.some((n) => /look swapped/.test(n))).toBe(true);
    expect(right.notes.some((n) => /look swapped|same hand/.test(n))).toBe(false);
  });
});

describe.skipIf(!real)('Live Test intake', () => {
  it('a motor-driven gecko wheel at the front is an intake: "in" pulls a POLLEN toward the robot, "out" pushes it away', async () => {
    const { Quaternion, Vector3, Box3 } = await import('three');
    const { instanceMatrix, v3 } = await import('../snap');
    const base = buildExampleRobot(cat);
    const box = new Box3();
    for (const i of base) box.union(new Box3(v3(cat[i.sku].bounds![0]), v3(cat[i.sku].bounds![1])).applyMatrix4(instanceMatrix(i)));
    const xf = box.max.x + 45;
    const mq = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2); // motor shaft +Y -> world −Z
    const wq = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // wheel axle X -> world −Z
    // a real intake: the soft wheel sits one ball-diameter up and pinches the ball against the tiles
    const y = buildRig(base, cat).groundY + 85;
    const list: PlacedInstance[] = [
      ...base,
      { instanceId: 'IM', sku: '5203-2402-0019', position: [xf, y, 20], quaternion: [mq.x, mq.y, mq.z, mq.w], hidden: false, ghosted: false },
      { instanceId: 'IW', sku: '3613-4008-0048', position: [xf, y, 20 - 22], quaternion: [wq.x, wq.y, wq.z, wq.w], hidden: false, ghosted: false },
    ];
    const rig = buildRig(list, cat);
    const intake = rig.actuators.find((a) => a.instanceId === 'IM')!;
    expect(intake.role).toBe('spinner');
    expect(intake.label).toMatch(/Intake/);
    const R = await loadRapier();
    const run = async (dir: number) => {
      const sim = new Sim(R, rig, cat, () => null);
      for (let i = 0; i < 60; i++) sim.step({ fwd: 0, strafe: 0, turn: 0, act: {} }, 1 / 120);
      // a POLLEN 8 cm ahead of the wheel (beside the motor face: the ball is wider than the 24 mm wheel);
      // drive slowly into it with the intake running
      const roller = () => sim.rollers[0].c.clone().applyMatrix4(sim.moving.get(sim.rollers[0].body)!.world);
      const c0 = roller();
      const el = sim.addElement('pollen', new Vector3(c0.x + 0.08, 0.0356, c0.z - 0.02));
      for (let i = 0; i < 240; i++) sim.step({ fwd: 0.12, strafe: 0, turn: 0, act: { [intake.id]: dir * (sim.inSign[intake.id] ?? 1) } }, 1 / 120);
      const rel = el.body.translation().x - roller().x; // < 0: the ball went under the wheel, into the robot
      sim.dispose();
      return rel;
    };
    const dIn = await run(1);
    const dOut = await run(-1);
    expect(dIn, `in ${dIn} out ${dOut}`).toBeLessThan(-0.02);
    expect(dOut, `in ${dIn} out ${dOut}`).toBeGreaterThan(0.03);
  });
});

describe.skipIf(!real)('Live Test arm', () => {
  it('a beam bolted to a hub on a motor is an arm: it turns while commanded and holds when released', async () => {
    const { Quaternion, Vector3, Box3, Matrix4 } = await import('three');
    const { instanceMatrix, v3 } = await import('../snap');
    const base = buildExampleRobot(cat);
    const box = new Box3();
    for (const i of base) box.union(new Box3(v3(cat[i.sku].bounds![0]), v3(cat[i.sku].bounds![1])).applyMatrix4(instanceMatrix(i)));
    const x0 = 0, y0 = box.max.y + 30, z0 = box.max.z + 5; // motor face, shaft pointing +Z (out the side)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2); // +Y -> +Z
    const bq = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)));
    const list: PlacedInstance[] = [
      ...base,
      { instanceId: 'AM', sku: '5203-2402-0019', position: [x0, y0, z0], quaternion: [q.x, q.y, q.z, q.w], hidden: false, ghosted: false },
      { instanceId: 'AH', sku: '1309-0016-4008', position: [x0, y0, z0 + 7], quaternion: [q.x, q.y, q.z, q.w], hidden: false, ghosted: false },
      { instanceId: 'AB', sku: '1102-0013-0104', position: [x0 + 8, y0 + 40, z0 + 12], quaternion: [bq.x, bq.y, bq.z, bq.w], hidden: false, ghosted: false },
    ];
    const rig = buildRig(list, cat);
    const arm = rig.actuators.find((a) => a.instanceId === 'AM')!;
    expect(arm.role).toBe('arm');
    const armBody = rig.bodies.find((b) => b.parts.some((p) => p.instanceId === 'AB'))!;
    expect(armBody.parts.some((p) => p.instanceId === 'AH')).toBe(true); // hub + beam turn together
    const R = await loadRapier();
    const sim = new Sim(R, rig, cat, () => null);
    for (let i = 0; i < 30; i++) sim.step({ fwd: 0, strafe: 0, turn: 0, act: { [arm.id]: 0.5 } }, 1 / 120);
    const a1 = sim.telemetry().angles[arm.id];
    expect(Math.abs(a1)).toBeGreaterThan(20); // 312 RPM at half power for 0.25 s ≈ 230°
    for (let i = 0; i < 60; i++) sim.step({ fwd: 0, strafe: 0, turn: 0, act: {} }, 1 / 120);
    expect(sim.telemetry().angles[arm.id]).toBeCloseTo(a1, 3);
    sim.dispose();
  });
});

describe('gear / sprocket names', () => {
  it('reads tooth counts, module and pitch radius', async () => {
    const { toothInfo, plausibleMesh } = await import('./partInfo');
    const g = (name: string) => toothInfo({ sku: 'x', name, category: 'Motion', massGrams: 1, priceUsd: 1, snapPoints: [] } as unknown as CatalogPart)!;
    const a = g('60 Tooth Hub-Mount Gear (MOD 0.8, 8mm Thick Acetal)');
    expect(a.kind).toBe('gear');
    expect(a.r).toBeCloseTo(24, 6);
    const b = g('2301 Series Steel, MOD 0.8 Pinion Gear (8mm REX Bore, 20 Tooth)');
    expect(b.r).toBeCloseTo(8, 6);
    expect(plausibleMesh(a, b, 32, true)).toBe(true);
    expect(plausibleMesh(a, b, 40, true)).toBe(false);
    const s = g('8mm Pitch Acetal Hub-Mount Sprocket (14mm Bore, 24 Tooth)');
    expect(s.kind).toBe('sprocket');
    expect(s.r).toBeGreaterThan(30);
    expect(toothInfo({ sku: 'y', name: '5203 Series Yellow Jacket Planetary Gear Motor (19.2:1 Ratio, 312 RPM)', category: 'Motors & Servos', massGrams: 1, priceUsd: 1, snapPoints: [] } as unknown as CatalogPart)).toBeNull();
  });
});

describe.skipIf(!real)('Live Test gears', () => {
  it('a 20T pinion on a motor drives a 40T gear on a shaft in a bearing at half speed, the other way round', async () => {
    const { Quaternion, Vector3 } = await import('three');
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2); // part +Y -> world +Z
    const Q: [number, number, number, number] = [q.x, q.y, q.z, q.w];
    const I = (instanceId: string, sku: string, position: [number, number, number]): PlacedInstance => ({ instanceId, sku, position, quaternion: Q, hidden: false, ghosted: false });
    const list = [
      ...buildExampleRobot(cat),
      I('GM', '5203-2402-0019', [0, 300, 0]),
      I('GP', '2303-4008-0020', [0, 300, 10]),
      I('GG', '2303-4008-0040', [24, 300, 10]),
      I('GS', '2106-4008-0320', [24, 300, 10]),
      I('GB', '1611-0514-4008', [24, 300, -2]),
    ];
    const rig = buildRig(list, cat);
    const bodyOf = (id: string) => rig.bodies.find((b) => b.parts.some((p) => p.instanceId === id))!;
    const motor = rig.actuators.find((a) => a.instanceId === 'GM')!;
    expect(bodyOf('GP').id).toBe(motor.body);
    expect(bodyOf('GG').id).toBe(bodyOf('GS').id); // gear locked on its shaft
    expect(bodyOf('GS').axis).toBeTruthy(); // shaft turns in the bearing
    expect(rig.couplings.some((c) => c.kind === 'gear')).toBe(true);
    const drive = bodyOf('GG').drive!;
    expect(drive.actuator).toBe(motor.id);
    // world angular velocities: ω_gear = −½ ω_pinion
    const wP = bodyOf('GP').axis!.clone().multiplyScalar(1);
    const wG = bodyOf('GG').axis!.clone().multiplyScalar(drive.ratio);
    expect(wG.dot(wP)).toBeCloseTo(-0.5, 6);
  });
});
