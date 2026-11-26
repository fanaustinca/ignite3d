// Live Test (beta) physics: Rapier world with the robot (one dynamic chassis + kinematic mechanisms), a few
// field tiles with walls, and BIOBUZZ game elements (POLLEN / NECTAR).
//
// Drivetrain: wheels are frictionless cylinders for support; traction is solved here per wheel with impulses
// along each wheel's constrained direction (traction: forward + sideways; mecanum: the floor roller's axis;
// omni: forward only), capped by friction (μN) and motor stall force. Any wheel layout works — commands are
// mapped to motors by inverse kinematics of the wheels the robot actually has.
//
// Mechanisms (arms, intakes, servos) are kinematic bodies driven by angle; they push game elements but never
// fight the chassis, so nothing can explode. Soft intake wheels grab elements with a spring "squish" model.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { CatalogPart } from '../types/cad';
import { instanceMatrix, q4, v3 } from '../lib/snap';
import { isHardware, isMotor, type Rig, type RigBody } from '../lib/drive/rig';

type R = typeof RAPIER_NS;
let rapierP: Promise<R> | null = null;
export function loadRapier() {
  rapierP ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = (m as unknown as { default?: R }).default ?? (m as unknown as R);
    await R.init();
    return R;
  });
  return rapierP;
}

export const MM = 0.001;
export const IN = 0.0254;
const G = 9.81;
export const TILE = 24 * IN;
export const FIELD_TILES = 4;
export const HALF = (FIELD_TILES * TILE) / 2;
export const ELEMENTS = {
  pollen: { r: (2.8 * IN) / 2, m: 0.028, color: 0xf2cf1d },
  nectar: { r: (3.6 * IN) / 2, m: 0.045, color: 0xd8262c },
} as const;
export type ElementKind = 'pollen' | 'nectarRed' | 'nectarBlue';

// collision groups: membership << 16 | filter
const GROUND = 0x1, ROBOT = 0x2, ELEM = 0x4;
const grp = (member: number, filter: number) => (member << 16) | filter;

export interface SimElement {
  id: number;
  kind: ElementKind;
  r: number;
  m: number;
  body: RAPIER_NS.RigidBody;
}
interface SimWheel {
  c: Vector3; // chassis-local (CAD frame, m)
  a: Vector3; // axle, chassis-local
  e: Vector3[]; // constrained ground directions, chassis-local, horizontal
  r: number;
  body: number; // rig body id (for the speed)
  driven: boolean;
  /** +1 when the wheel's own axle points along its joint axis, −1 when opposite. */
  sgn: number;
}
interface SimRoller {
  body: number;
  c: Vector3; // in that body's frame (CAD, m)
  a: Vector3;
  R: number;
  w: number;
  squish: number;
}
interface StopShape {
  shape: RAPIER_NS.Shape;
  /** rest-frame (CAD m) box, for a quick reject */
  box: Box3;
  /** owner: chassis id or a moving body id */
  owner: number;
}
interface MovingBody {
  rig: RigBody;
  rb: RAPIER_NS.RigidBody | null; // kinematic, null when it has no colliders
  angle: number;
  speed: number; // rad/s about its axis (relative to parent), this step
  axis: Vector3; // in parent frame at rest (CAD, unit)
  pivot: Vector3; // m
  world: Matrix4; // current world transform (CAD m-frame -> world)
}

export interface Commands {
  /** Robot-relative velocity request in [-1, 1]: forward, strafe right, turn clockwise. */
  fwd: number;
  strafe: number;
  turn: number;
  /** Per actuator: motor power [-1, 1] (spinners, arms) or servo velocity [-1, 1]. */
  act: Record<number, number>;
}

export interface Telemetry {
  speed: number; // m/s
  heading: number; // deg
  motors: Record<number, number>; // power
  angles: Record<number, number>; // deg, per actuator (arms / servos)
  tipped: boolean;
  /** actuators held at a hard stop this step */
  stopped: Record<number, boolean>;
}

const tmpQ = new Quaternion();

export class Sim {
  R: R;
  world: RAPIER_NS.World;
  rig: Rig;
  chassis: RAPIER_NS.RigidBody;
  chassisId: number;
  /** Robot heading offset (which CAD direction is "forward"): radians about +Y applied to +Z. */
  frontYaw = 0;
  wheels: SimWheel[] = [];
  rollers: SimRoller[] = [];
  moving = new Map<number, MovingBody>();
  order: number[] = []; // moving bodies, parents first
  elements: SimElement[] = [];
  private nextEl = 1;
  mass: number; // kg
  com: Vector3; // chassis-local (m)
  invI: Vector3; // chassis-local diagonal inverse inertia
  motorPower: Record<number, number> = {};
  servoTarget: Record<number, number> = {};
  /** Per spinner actuator: power sign that pulls game elements INTO the robot. */
  inSign: Record<number, number> = {};
  /** Max robot speed (m/s) / turn rate (rad/s) from the motors + wheels. */
  vmax = 0;
  wmax = 0;
  spawn: { p: Vector3; q: Quaternion };
  t = 0;
  /** Robot footprint radius (m), for spawning game elements clear of it. */
  reach = 0.3;
  /** Hard stops: hull shapes of arm parts (by moving body) and of everything they could hit. */
  private armShapes = new Map<number, StopShape[]>();
  private obstacles: StopShape[] = [];
  private restOverlap = new Set<string>();
  stopped: Record<number, boolean> = {};

  constructor(R: R, rig: Rig, _catalog: Record<string, CatalogPart>, meshOf: (p: CatalogPart) => { triangles: Float32Array } | null) {
    this.R = R;
    this.rig = rig;
    this.world = new R.World({ x: 0, y: -G, z: 0 });
    this.world.timestep = 1 / 120;
    this.buildField();
    const chassis = rig.bodies.find((b) => b.label === 'Chassis')!;
    this.chassisId = chassis.id;

    // which bodies move on their own (have a joint + a driver); everything else is welded to its moving ancestor
    const movingIds = new Set(rig.bodies.filter((b) => b.axis && b.drive && b.parent !== null).map((b) => b.id));
    const ownerOf = (b: RigBody): number => {
      let cur: RigBody | undefined = b;
      while (cur && cur.id !== chassis.id && !movingIds.has(cur.id)) cur = cur.parent === null ? undefined : rig.bodies[cur.parent];
      return cur ? cur.id : chassis.id;
    };

    // spawn: centre of the field, lowest point 2 mm above the tiles
    const box = new Box3();
    for (const b of rig.bodies) for (const p of b.parts) if (!isHardware(p.part)) box.union(partBox(p.part, p.inst));
    const centre = box.getCenter(new Vector3());
    this.reach = (Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * MM;
    this.spawn = { p: new Vector3(-centre.x * MM, -rig.groundY * MM + 0.002, -centre.z * MM), q: new Quaternion() };

    this.chassis = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(this.spawn.p.x, this.spawn.p.y, this.spawn.p.z).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.4),
    );

    // mass properties of the whole robot on the chassis (mechanisms are kinematic, their mass still counts)
    this.mass = Math.max(0.2, rig.mass / 1000);
    this.com = rig.cog.clone().multiplyScalar(MM);
    const I = new Vector3();
    for (const b of rig.bodies)
      for (const p of b.parts) {
        const pb = partBox(p.part, p.inst);
        const m = p.part.massGrams / 1000;
        const s = pb.getSize(new Vector3()).multiplyScalar(MM);
        const d = pb.getCenter(new Vector3()).multiplyScalar(MM).sub(this.com);
        I.x += (m * (s.y * s.y + s.z * s.z)) / 12 + m * (d.y * d.y + d.z * d.z);
        I.y += (m * (s.x * s.x + s.z * s.z)) / 12 + m * (d.x * d.x + d.z * d.z);
        I.z += (m * (s.x * s.x + s.y * s.y)) / 12 + m * (d.x * d.x + d.y * d.y);
      }
    I.max(new Vector3(1e-3, 1e-3, 1e-3));
    this.invI = new Vector3(1 / I.x, 1 / I.y, 1 / I.z);
    this.chassis.setAdditionalMassProperties(this.mass, { x: this.com.x, y: this.com.y, z: this.com.z }, { x: I.x, y: I.y, z: I.z }, { x: 0, y: 0, z: 0, w: 1 }, true);

    // moving bodies (kinematic), parents first
    const visit = (id: number) => {
      if (this.moving.has(id) || !movingIds.has(id)) return;
      const b = rig.bodies[id];
      const parentOwner = b.parent === null ? chassis.id : ownerOf(rig.bodies[b.parent]);
      if (parentOwner !== chassis.id) visit(parentOwner);
      const hasDriveWheels = b.wheels.length > 0;
      const rb = hasDriveWheels ? null : this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.spawn.p.x, this.spawn.p.y, this.spawn.p.z));
      this.moving.set(id, { rig: b, rb, angle: 0, speed: 0, axis: b.axis!.clone().normalize(), pivot: b.pivot!.clone().multiplyScalar(MM), world: new Matrix4() });
      this.order.push(id);
    };
    for (const id of movingIds) visit(id);

    // colliders: every non-hardware part goes on the body that carries it
    const wheelIds = new Set(rig.bodies.flatMap((b) => b.wheels.map((w) => w.instanceId)));
    const rollerIds = new Map(rig.bodies.flatMap((b) => b.rollers.map((r) => [r.instanceId, r] as const)));
    for (const b of rig.bodies) {
      const owner = ownerOf(b);
      const mv = this.moving.get(owner);
      const target = owner === chassis.id ? this.chassis : mv?.rb;
      if (!target) continue; // drive-wheel bodies: wheels are handled as contacts
      for (const p of b.parts) {
        if (isHardware(p.part) || wheelIds.has(p.instanceId)) continue;
        const roller = rollerIds.get(p.instanceId);
        if (roller) {
          // soft intake wheel: a rigid core (radius − squish); the squish is modelled as a spring in step()
          // the rigid core leaves room for the tread AND the foam ball to squish (POLLEN / NECTAR give ~6 mm)
          const core = Math.max(roller.radius * 0.45, roller.radius - roller.squish - 6);
          const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), roller.axle);
          this.world.createCollider(
            R.ColliderDesc.cylinder((roller.width / 2) * MM, core * MM)
              .setTranslation(roller.centre.x * MM, roller.centre.y * MM, roller.centre.z * MM)
              .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
              .setFriction(1.1)
              .setDensity(0)
              .setCollisionGroups(grp(ROBOT, ELEM)),
            target,
          );
          this.rollers.push({ body: owner, c: roller.centre.clone().multiplyScalar(MM), a: roller.axle.clone(), R: roller.radius * MM, w: roller.width * MM, squish: roller.squish * MM });
          continue;
        }
        // game elements touch the real shape (a stopper, a U-channel, a funnel): triangle mesh; the floor only
        // needs the convex hull (and only the chassis can touch the floor)
        const tm = trimeshDesc(R, p.part, p.inst, meshOf);
        const hull = hullDesc(R, p.part, p.inst, meshOf);
        if (tm) {
          tm.setFriction(0.6).setRestitution(0.1).setDensity(0).setCollisionGroups(grp(ROBOT, ELEM));
          this.world.createCollider(tm, target);
          if (owner === chassis.id && hull) this.world.createCollider(hull.setFriction(0.6).setRestitution(0.1).setDensity(0).setCollisionGroups(grp(ROBOT, GROUND)), target);
        } else if (hull) {
          hull.setFriction(0.6).setRestitution(0.1).setDensity(0).setCollisionGroups(grp(ROBOT, owner === chassis.id ? GROUND | ELEM : ELEM));
          this.world.createCollider(hull, target);
        }
        const st = stopShape(R, p.part, p.inst, meshOf, owner);
        if (st) {
          if (owner !== chassis.id) (this.armShapes.get(owner) ?? this.armShapes.set(owner, []).get(owner)!).push(st.shrunk);
          this.obstacles.push(st.full);
        }
      }
    }

    // drive wheels: a frictionless cylinder on the chassis + a traction contact solved in step()
    for (const b of rig.bodies)
      for (const w of b.wheels) {
        const c = w.centre.clone().multiplyScalar(MM);
        const r = w.info.radius * MM;
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), w.axle);
        this.world.createCollider(
          R.ColliderDesc.cylinder(Math.max(0.004, (w.info.width / 2) * MM * 0.9), r - 0.0004)
            .setTranslation(c.x, c.y, c.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setFriction(0)
            .setFrictionCombineRule(R.CoefficientCombineRule.Min)
            .setRestitution(0)
            .setDensity(0)
            .setCollisionGroups(grp(ROBOT, GROUND | ELEM)),
          this.chassis,
        );
        const f = w.axle.clone().cross(new Vector3(0, -1, 0)).normalize(); // floor point's surface velocity for +ω
        const lat = new Vector3(0, 1, 0).cross(f).normalize();
        // the motor-driven body this wheel spins with (a drive body is "moving"; a free wheel has none)
        const driven = movingIds.has(b.id);
        // constrained floor directions: a free wheel rolls freely along f (traction keeps only sideways grip;
        // free mecanum / omni wheels constrain nothing)
        const e = w.info.mecanum && w.roller ? (driven ? [w.roller.clone()] : []) : w.info.omni ? (driven ? [f.clone()] : []) : driven ? [f.clone(), lat] : [lat];
        const sgn = b.axis ? Math.sign(b.axis.dot(w.axle)) || 1 : 1;
        this.wheels.push({ c, a: w.axle.clone(), e, r, body: driven ? b.id : -1, driven, sgn });
      }
    this.computeLimits();
    this.computeInSigns();
    this.frontYaw = this.autoFront();
    this.prepareStops();
    this.updateKinematics(0);
    this.syncWorld();
  }

  // ------------------------------------------------------------------ hard stops (arms hit the frame / stoppers)
  /** Moving body ids from `id` up to the chassis. */
  private chainOf(id: number) {
    const out = new Set<number>([id]);
    let cur: number | null = this.rig.bodies[id].parent;
    while (cur !== null) {
      out.add(cur);
      cur = this.rig.bodies[cur].parent;
    }
    return out;
  }
  private related(a: number, b: number) {
    return this.chainOf(a).has(b) || this.chainOf(b).has(a);
  }
  private prepareStops() {
    // only arms / servos stop on things; spinners turn freely (their parts are round)
    for (const [id, list] of this.armShapes) {
      const act = this.rig.actuators[this.rig.bodies[id].drive?.actuator ?? -1];
      const m = this.moving.get(id);
      if (!act || act.role !== 'arm' || !m) {
        this.armShapes.delete(id);
        continue;
      }
      // parts around the pivot (hub, shaft, gear) are the joint itself
      const keep = list.filter((s) => {
        const c = s.box.getCenter(new Vector3());
        const d = c.clone().sub(m.pivot);
        const radial = d.addScaledVector(m.axis, -d.dot(m.axis)).length();
        return radial > 0.022 || s.box.getSize(new Vector3()).length() > 0.09;
      });
      this.armShapes.set(id, keep);
      // what already overlaps at rest is part of the build (a joint, a part that sits in another): ignore it
      for (const [k, a] of keep.entries())
        for (const [j, o] of this.obstacles.entries()) {
          if (o.owner === id || (o.owner !== this.chassisId && this.related(id, o.owner))) continue;
          if (a.box.intersectsBox(o.box) && intersects(a, IDENT, o, IDENT)) this.restOverlap.add(`${id}:${k}:${j}`);
        }
    }
  }
  /** Pose (relative to the chassis, CAD m frame) of a moving body if its own angle were `angle`. */
  private relPose(id: number, angle?: number): Matrix4 {
    const b = this.moving.get(id);
    const parentId = this.rig.bodies[id].parent;
    let parent = new Matrix4();
    if (parentId !== null && parentId !== this.chassisId) {
      // nearest moving ancestor
      let cur: number | null = parentId;
      while (cur !== null && cur !== this.chassisId && !this.moving.has(cur)) cur = this.rig.bodies[cur].parent;
      if (cur !== null && cur !== this.chassisId) parent = this.relPose(cur);
    }
    if (!b) return parent;
    const a = angle ?? b.angle;
    return parent
      .multiply(new Matrix4().makeTranslation(b.pivot.x, b.pivot.y, b.pivot.z))
      .multiply(new Matrix4().makeRotationAxis(b.axis, a))
      .multiply(new Matrix4().makeTranslation(-b.pivot.x, -b.pivot.y, -b.pivot.z));
  }
  /** Would moving body `id` hit something at this angle? */
  private blockedAt(id: number, angle: number) {
    const shapes = this.armShapes.get(id);
    if (!shapes?.length) return false;
    const M = this.relPose(id, angle);
    const poses = new Map<number, Matrix4>();
    const poseOf = (owner: number) => {
      if (owner === this.chassisId) return IDENT;
      let p = poses.get(owner);
      if (!p) poses.set(owner, (p = this.relPose(owner)));
      return p;
    };
    for (const [k, a] of shapes.entries()) {
      const ab = a.box.clone().applyMatrix4(M);
      for (const [j, o] of this.obstacles.entries()) {
        if (o.owner === id || this.restOverlap.has(`${id}:${k}:${j}`)) continue;
        if (o.owner !== this.chassisId && this.related(id, o.owner)) continue;
        const P = poseOf(o.owner);
        if (!ab.intersectsBox(o.box.clone().applyMatrix4(P))) continue;
        if (intersects(a, M, o, P)) return true;
      }
    }
    return false;
  }

  /**
   * For each intake: which spin direction pulls elements in. Elements arrive from outside the robot and from below
   * (on the floor), so look at the roller surface on that side and make it move toward the robot's centre.
   */
  private computeInSigns() {
    for (const a of this.rig.actuators) {
      if (a.role !== 'spinner') continue;
      let score = 0;
      for (const r of this.rollers) {
        const m = this.moving.get(r.body);
        if (!m || this.rig.bodies[r.body].drive?.actuator !== a.id) continue;
        const ratio = this.rig.bodies[r.body].drive!.ratio;
        const o = r.c.clone().sub(this.com).setY(0);
        if (o.lengthSq() < 1e-8) continue;
        o.normalize();
        const ax = m.axis.clone(); // joint axis (≈ roller axle) at rest
        let u = o.clone().add(new Vector3(0, -1, 0));
        u.addScaledVector(ax, -u.dot(ax));
        if (u.lengthSq() < 1e-6) {
          u = new Vector3(0, -1, 0).addScaledVector(ax, -ax.y);
          if (u.lengthSq() < 1e-6) continue;
        }
        u.normalize();
        const v = ax.clone().multiplyScalar(ratio).cross(u); // surface velocity there for +1 power (per unit ω)
        score += -v.dot(o);
      }
      this.inSign[a.id] = score < 0 ? -1 : 1;
    }
  }

  /**
   * Which way is "forward": along the drive wheels' rolling direction (perpendicular to their axles), pointing
   * toward the intake rollers if the robot has any, else toward +Z / +X (the CAD view's front / right).
   */
  autoFront() {
    let ax = 0, az = 0;
    for (const w of this.wheels) {
      const f = w.a.clone().cross(new Vector3(0, -1, 0));
      ax += Math.abs(f.x);
      az += Math.abs(f.z);
    }
    const alongX = ax > az * 1.2;
    let sign = 1;
    if (this.rollers.length) {
      const c = this.rollers.reduce((s, r) => s.add(r.c), new Vector3()).multiplyScalar(1 / this.rollers.length).sub(this.com);
      const d = alongX ? c.x : c.z;
      if (Math.abs(d) > 0.01) sign = Math.sign(d);
    }
    return alongX ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : sign > 0 ? 0 : Math.PI;
  }

  // ------------------------------------------------------------------ field
  private buildField() {
    const R = this.R;
    const floor = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.world.createCollider(R.ColliderDesc.cuboid(HALF + 0.5, 0.05, HALF + 0.5).setTranslation(0, -0.05, 0).setFriction(0.9).setCollisionGroups(grp(GROUND, ROBOT | ELEM)), floor);
    const h = 0.31, t = 0.025;
    for (const [x, z, hx, hz] of [
      [0, HALF + t, HALF + t * 2, t],
      [0, -HALF - t, HALF + t * 2, t],
      [HALF + t, 0, t, HALF],
      [-HALF - t, 0, t, HALF],
    ])
      this.world.createCollider(R.ColliderDesc.cuboid(hx, h / 2, hz).setTranslation(x, h / 2, z).setFriction(0.4).setRestitution(0.3).setCollisionGroups(grp(GROUND, ROBOT | ELEM)), floor);
  }

  // ------------------------------------------------------------------ elements
  addElement(kind: ElementKind, at?: Vector3) {
    const spec = kind === 'pollen' ? ELEMENTS.pollen : ELEMENTS.nectar;
    let p = at;
    if (!p) {
      // somewhere on the tiles, but never inside / under the robot
      const c = this.com.clone().applyMatrix4(this.chassisMatrix());
      for (let k = 0; k < 40; k++) {
        p = new Vector3((Math.random() - 0.5) * (2 * HALF - 0.3), spec.r + 0.02, (Math.random() - 0.5) * (2 * HALF - 0.3));
        if (Math.hypot(p.x - c.x, p.z - c.z) > this.reach + spec.r + 0.05) break;
      }
    }
    p = p!;
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.35));
    // squishy foam balls: the collider is a little smaller than the ball you see
    this.world.createCollider(
      this.R.ColliderDesc.ball(spec.r * 0.95).setMass(spec.m).setFriction(0.8).setRestitution(0.35).setCollisionGroups(grp(ELEM, GROUND | ROBOT | ELEM)),
      body,
    );
    const el: SimElement = { id: this.nextEl++, kind, r: spec.r, m: spec.m, body };
    this.elements.push(el);
    return el;
  }
  removeElements() {
    for (const e of this.elements) this.world.removeRigidBody(e.body);
    this.elements = [];
  }

  // ------------------------------------------------------------------ robot pose
  chassisMatrix(out = new Matrix4()) {
    const t = this.chassis.translation(), r = this.chassis.rotation();
    return out.compose(new Vector3(t.x, t.y, t.z), tmpQ.set(r.x, r.y, r.z, r.w), new Vector3(1, 1, 1));
  }
  resetRobot() {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0);
    this.chassis.setTranslation(this.spawn.p, true);
    this.chassis.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const m of this.moving.values()) m.angle = 0;
    this.updateKinematics(0);
    this.syncWorld();
  }

  /** "front-left" etc. for a drive motor, from where its wheels sit relative to the current front. */
  driveLabel(actId: number) {
    const ws = this.wheels.filter((w) => w.driven && this.rig.bodies[w.body].drive?.actuator === actId);
    if (!ws.length) return this.rig.actuators[actId].label;
    const c = ws.reduce((s, w) => s.add(w.c), new Vector3()).multiplyScalar(1 / ws.length).sub(this.com);
    const { fwd, right } = this.frontAxes();
    const f = c.dot(fwd), r = c.dot(right);
    return [f > 0.005 ? 'front' : f < -0.005 ? 'back' : '', r > 0.005 ? 'right' : r < -0.005 ? 'left' : ''].filter(Boolean).join('-') || 'middle';
  }

  /** Robot "forward" and "right" in chassis-local coordinates (horizontal). */
  frontAxes() {
    const fwd = new Vector3(Math.sin(this.frontYaw), 0, Math.cos(this.frontYaw));
    const right = fwd.clone().cross(new Vector3(0, 1, 0)).normalize(); // facing +Z, right is −X
    return { fwd, right };
  }

  private computeLimits() {
    let v = Infinity;
    let rr = 0;
    for (const w of this.wheels) {
      if (!w.driven) continue;
      const b = this.rig.bodies[w.body];
      const a = this.rig.actuators[b.drive!.actuator];
      v = Math.min(v, a.freeRadS * Math.abs(b.drive!.ratio) * w.r);
      rr += Math.hypot(w.c.x - this.com.x, w.c.z - this.com.z);
    }
    const n = this.wheels.filter((w) => w.driven).length;
    this.vmax = Number.isFinite(v) ? v : 0;
    this.wmax = n ? this.vmax / Math.max(0.05, rr / n) : 0;
  }

  /**
   * Motor powers for a requested robot motion: each drive wheel's required surface speed from the chassis
   * twist (s = −(V·e)/(f·e) along its constrained direction), averaged per motor, scaled into [-1, 1].
   */
  driveIK(fwd: number, strafe: number, turn: number) {
    const out: Record<number, number> = {};
    if (!this.vmax) return out;
    const { fwd: F, right } = this.frontAxes();
    const v = F.clone().multiplyScalar(fwd * this.vmax).add(right.clone().multiplyScalar(strafe * this.vmax));
    const wy = -turn * this.wmax; // clockwise seen from above = −Y
    const sum: Record<number, number> = {}, cnt: Record<number, number> = {};
    for (const w of this.wheels) {
      if (!w.driven || !w.e.length) continue;
      const b = this.rig.bodies[w.body];
      const act = this.rig.actuators[b.drive!.actuator];
      const rel = w.c.clone().sub(this.com);
      const V = v.clone().add(new Vector3(0, wy, 0).cross(rel));
      V.y = 0;
      const f = w.a.clone().cross(new Vector3(0, -1, 0)).normalize();
      const e = w.e[0];
      const fe = f.dot(e);
      if (Math.abs(fe) < 0.2) continue;
      // contact velocity along e must vanish: (V + s f)·e = 0
      const s = -V.dot(e) / fe;
      const u = s / (act.freeRadS * b.drive!.ratio * w.r * w.sgn);
      sum[act.id] = (sum[act.id] ?? 0) + u;
      cnt[act.id] = (cnt[act.id] ?? 0) + 1;
    }
    let max = 1;
    for (const k in sum) {
      out[k] = sum[k] / cnt[k];
      max = Math.max(max, Math.abs(out[k]));
    }
    for (const k in out) out[k] /= max;
    return out;
  }

  // ------------------------------------------------------------------ kinematics of mechanisms
  /** Chassis pose integrated one step ahead with its current velocity. */
  private predictedChassis(dt: number) {
    const t = this.chassis.translation(), r = this.chassis.rotation();
    const lv = this.chassis.linvel(), av = this.chassis.angvel();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const w = new Vector3(av.x, av.y, av.z);
    const ang = w.length() * dt;
    if (ang > 1e-9) q.premultiply(new Quaternion().setFromAxisAngle(w.normalize(), ang));
    return new Matrix4().compose(new Vector3(t.x + lv.x * dt, t.y + lv.y * dt, t.z + lv.z * dt), q, new Vector3(1, 1, 1));
  }
  /** After a physics step: every mechanism's world pose from where the chassis actually is now. */
  private syncWorld() {
    const cm = this.chassisMatrix();
    for (const id of this.order) {
      const m = this.moving.get(id)!;
      const parent = m.rig.parent === null || m.rig.parent === this.chassisId ? cm : this.parentWorld(m.rig.parent, cm);
      m.world.copy(parent).multiply(this.jointLocal(m));
    }
  }
  private jointLocal(m: MovingBody) {
    return new Matrix4()
      .makeTranslation(m.pivot.x, m.pivot.y, m.pivot.z)
      .multiply(new Matrix4().makeRotationAxis(m.axis, m.angle))
      .multiply(new Matrix4().makeTranslation(-m.pivot.x, -m.pivot.y, -m.pivot.z));
  }
  private updateKinematics(dt: number, chassisAt?: Matrix4) {
    const cm = chassisAt ?? this.chassisMatrix();
    for (const id of this.order) {
      const m = this.moving.get(id)!;
      m.angle += m.speed * dt;
      const parent = m.rig.parent === null || m.rig.parent === this.chassisId ? cm : this.parentWorld(m.rig.parent, cm);
      const local = new Matrix4()
        .makeTranslation(m.pivot.x, m.pivot.y, m.pivot.z)
        .multiply(new Matrix4().makeRotationAxis(m.axis, m.angle))
        .multiply(new Matrix4().makeTranslation(-m.pivot.x, -m.pivot.y, -m.pivot.z));
      m.world.copy(parent).multiply(local);
      if (m.rb) {
        const p = new Vector3(), q = new Quaternion(), s = new Vector3();
        m.world.decompose(p, q, s);
        m.rb.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
        m.rb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
    }
  }
  private parentWorld(id: number, cm: Matrix4): Matrix4 {
    // nearest moving ancestor's world transform
    let cur: number | null = id;
    while (cur !== null && cur !== this.chassisId) {
      const m = this.moving.get(cur);
      if (m) return m.world;
      cur = this.rig.bodies[cur].parent;
    }
    return cm;
  }
  bodyWorld(id: number, cm = this.chassisMatrix()) {
    return this.parentWorld(id, cm);
  }

  // ------------------------------------------------------------------ step
  step(cmd: Commands, dt: number) {
    // 1. actuator commands -> joint speeds
    const drive = this.driveIK(cmd.fwd, cmd.strafe, cmd.turn);
    const power: Record<number, number> = { ...drive };
    for (const a of this.rig.actuators) {
      if (a.role === 'drive') continue;
      power[a.id] = cmd.act[a.id] ?? 0;
    }
    this.motorPower = power;
    for (const m of this.moving.values()) {
      const d = m.rig.drive!;
      const a = this.rig.actuators[d.actuator];
      let w = (power[a.id] ?? 0) * a.freeRadS * d.ratio;
      if (a.kind === 'servo' && a.rangeDeg) {
        // servo: position limits (±range/2 at the spline)
        const lim = ((a.rangeDeg / 2) * Math.PI) / 180;
        const at = m.angle / (d.ratio || 1);
        if ((at >= lim && w / (d.ratio || 1) > 0) || (at <= -lim && w / (d.ratio || 1) < 0)) w = 0;
      }
      m.speed = w;
    }
    // hard stops: an arm that would run into the frame / a stopper stays where it is
    this.stopped = {};
    for (const a of this.rig.actuators) {
      if (a.role !== 'arm') continue;
      const bodies = [...this.moving.values()].filter((m) => m.rig.drive?.actuator === a.id && m.speed !== 0);
      if (!bodies.length) continue;
      if (bodies.some((m) => this.armShapes.has(m.rig.id) && this.blockedAt(m.rig.id, m.angle + m.speed * dt) && !this.blockedAt(m.rig.id, m.angle))) {
        for (const m of bodies) m.speed = 0;
        this.stopped[a.id] = true;
      }
    }

    // 2. traction
    this.traction(power, dt);

    // 3. soft intake rollers grab elements
    this.rollerForces(dt);

    // 4. mechanisms + physics: kinematic targets use where the chassis will be after this step (else the
    // mechanisms trail the chassis by a step and visibly slide back and forth as it speeds up / slows down)
    this.updateKinematics(dt, this.predictedChassis(dt));
    this.world.step();
    this.t += dt;
    this.syncWorld();

    // safety net: anything that escapes the field comes back
    for (const e of this.elements) {
      const p = e.body.translation();
      if (p.y < -0.5 || Math.abs(p.x) > HALF + 0.4 || Math.abs(p.z) > HALF + 0.4) {
        e.body.setTranslation({ x: (Math.random() - 0.5) * HALF, y: 0.3, z: (Math.random() - 0.5) * HALF }, true);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    const cp = this.chassis.translation();
    if (cp.y < -1 || Math.abs(cp.x) > HALF + 1 || Math.abs(cp.z) > HALF + 1) this.resetRobot();
  }

  private traction(power: Record<number, number>, dt: number) {
    const R = this.chassis.rotation();
    const q = new Quaternion(R.x, R.y, R.z, R.w);
    const t = this.chassis.translation();
    const T = new Vector3(t.x, t.y, t.z);
    const lv = this.chassis.linvel(), av = this.chassis.angvel();
    const v = new Vector3(lv.x, lv.y, lv.z), w = new Vector3(av.x, av.y, av.z);
    const comW = this.com.clone().applyQuaternion(q).add(T);
    const qi = q.clone().invert();
    const invIw = (x: Vector3) => {
      const l = x.clone().applyQuaternion(qi);
      l.set(l.x * this.invI.x, l.y * this.invI.y, l.z * this.invI.z);
      return l.applyQuaternion(q);
    };
    // floor contacts
    const contacts: { P: Vector3; rel: Vector3; e: Vector3; f: Vector3; s: number; driven: boolean; cap: number }[] = [];
    const onFloor: { wheel: SimWheel; c: Vector3; a: Vector3 }[] = [];
    for (const wh of this.wheels) {
      const c = wh.c.clone().applyQuaternion(q).add(T);
      const a = wh.a.clone().applyQuaternion(q);
      const reach = wh.r * Math.sqrt(Math.max(0, 1 - a.y * a.y));
      if (c.y - reach > 0.004 || Math.abs(a.y) > 0.6) continue;
      onFloor.push({ wheel: wh, c, a });
    }
    if (!onFloor.length) return;
    const N = (this.mass * G) / onFloor.length;
    for (const { wheel: wh, c, a } of onFloor) {
      const P = c.clone().add(new Vector3(0, -wh.r, 0));
      const rel = P.clone().sub(comW);
      const f = a.clone().cross(new Vector3(0, -1, 0)).normalize();
      let s = 0, cap = 0;
      if (wh.driven) {
        const b = this.rig.bodies[wh.body];
        const act = this.rig.actuators[b.drive!.actuator];
        s = (power[act.id] ?? 0) * act.freeRadS * b.drive!.ratio * wh.r * wh.sgn; // wheel surface speed (m/s), about its own axle
        cap = act.stallNm / Math.max(1e-3, Math.abs(b.drive!.ratio)) / wh.r; // stall force at the tread
      }
      for (const eL of wh.e) {
        const e = eL.clone().applyQuaternion(q);
        e.y = 0;
        if (e.lengthSq() < 1e-6) continue;
        e.normalize();
        const along = Math.abs(f.dot(e)) > 0.2; // this direction is driven by the wheel's spin
        contacts.push({ P, rel, e, f, s: along ? s : 0, driven: along && wh.driven, cap: along && wh.driven ? cap : Infinity });
      }
    }
    const mu = 1.0;
    const Jsum = new Vector3(), Lsum = new Vector3();
    const acc = new Float64Array(contacts.length);
    for (let it = 0; it < 6; it++)
      for (let k = 0; k < contacts.length; k++) {
        const c = contacts[k];
        const vp = v.clone().add(w.clone().cross(c.rel));
        // contact velocity along e must equal −s·(f·e) (wheel surface moving the other way)
        const err = vp.dot(c.e) + c.s * c.f.dot(c.e);
        const rxe = c.rel.clone().cross(c.e);
        const meff = 1 / (1 / this.mass + rxe.dot(invIw(rxe)));
        let lam = -err * meff;
        const limit = Math.min(mu * N, c.cap) * dt;
        const old = acc[k];
        acc[k] = Math.max(-limit, Math.min(limit, old + lam));
        lam = acc[k] - old;
        const J = c.e.clone().multiplyScalar(lam);
        v.addScaledVector(J, 1 / this.mass);
        w.add(invIw(c.rel.clone().cross(J)));
        Jsum.add(J);
        Lsum.add(c.rel.clone().cross(J));
      }
    this.chassis.applyImpulse({ x: Jsum.x, y: Jsum.y, z: Jsum.z }, true);
    this.chassis.applyTorqueImpulse({ x: Lsum.x, y: Lsum.y, z: Lsum.z }, true);
  }

  private rollerForces(dt: number) {
    if (!this.rollers.length || !this.elements.length) return;
    const cm = this.chassisMatrix();
    const lv = this.chassis.linvel(), av = this.chassis.angvel();
    const cv = new Vector3(lv.x, lv.y, lv.z), cw = new Vector3(av.x, av.y, av.z);
    const comW = this.com.clone().applyMatrix4(cm);
    for (const r of this.rollers) {
      const m = this.moving.get(r.body);
      if (!m) continue;
      const M = m.world;
      const c = r.c.clone().applyMatrix4(M);
      const a = r.a.clone().transformDirection(M);
      // world spin of this roller: its joint axis (in world) × joint speed
      const jointAxis = m.axis.clone().transformDirection(this.parentWorld(m.rig.parent ?? this.chassisId, cm));
      const spin = jointAxis.multiplyScalar(m.speed);
      for (const e of this.elements) {
        const p = e.body.translation();
        const P = new Vector3(p.x, p.y, p.z);
        const d = P.clone().sub(c);
        const ax = d.dot(a);
        if (Math.abs(ax) > r.w / 2 + e.r * 0.6) continue;
        const radial = d.clone().sub(a.clone().multiplyScalar(ax));
        const dist = radial.length();
        const pen = r.R + e.r - dist;
        if (pen <= 0 || dist < 1e-4) continue;
        const n = radial.multiplyScalar(1 / dist); // roller -> element
        // compressed tread + foam ball: a soft spring (both squish) with damping
        const k = 150; // N/m
        const contact = c.clone().add(a.clone().multiplyScalar(ax)).addScaledVector(n, r.R - Math.min(pen, r.squish) * 0.5);
        const lvE = e.body.linvel();
        const ve = new Vector3(lvE.x, lvE.y, lvE.z);
        // surface velocity of the roller at the contact (spin + chassis motion)
        const vs = spin.clone().cross(contact.clone().sub(c)).add(cv.clone().add(cw.clone().cross(contact.clone().sub(comW))));
        const relN = ve.clone().sub(vs).dot(n);
        const Fn = Math.max(0, k * Math.min(pen, r.squish + 0.006 + e.r * 0.1) - 0.6 * relN);
        const Jn = n.clone().multiplyScalar(Fn * dt);
        // grip: drag the ball's surface toward the roller's surface speed, limited by μ·Fn
        const avE = e.body.angvel();
        const relT = ve.clone().add(new Vector3(avE.x, avE.y, avE.z).cross(n.clone().multiplyScalar(-e.r))).sub(vs); // ball surface vs roller surface
        relT.addScaledVector(n, -relT.dot(n));
        const want = relT.multiplyScalar(-e.m * 0.25); // ~ effective mass of a rolling ball at its rim
        const lim = 1.3 * Math.max(Fn, e.m * G) * dt;
        if (want.length() > lim) want.setLength(lim);
        // squish pushes on the centre; grip acts on the ball's surface, so the ball rolls (it doesn't skid on the tiles)
        e.body.applyImpulse({ x: Jn.x, y: Jn.y, z: Jn.z }, true);
        const onBall = P.clone().addScaledVector(n, -e.r);
        e.body.applyImpulseAtPoint({ x: want.x, y: want.y, z: want.z }, { x: onBall.x, y: onBall.y, z: onBall.z }, true);
      }
    }
  }

  telemetry(): Telemetry {
    const lv = this.chassis.linvel();
    const r = this.chassis.rotation();
    const q = new Quaternion(r.x, r.y, r.z, r.w);
    const { fwd } = this.frontAxes();
    const f = fwd.clone().applyQuaternion(q);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const angles: Record<number, number> = {};
    for (const m of this.moving.values()) {
      const d = m.rig.drive!;
      const a = this.rig.actuators[d.actuator];
      if (a.role === 'arm') angles[a.id] = ((m.angle / (d.ratio || 1)) * 180) / Math.PI;
    }
    return { speed: Math.hypot(lv.x, lv.z), heading: (Math.atan2(f.x, f.z) * 180) / Math.PI, motors: this.motorPower, angles, tipped: up.y < 0.5, stopped: { ...this.stopped } };
  }

  dispose() {
    this.world.free();
  }
}

function partBox(part: CatalogPart, inst: { position: [number, number, number]; quaternion: [number, number, number, number] }) {
  const b = part.bounds ? new Box3(v3(part.bounds[0]), v3(part.bounds[1])) : new Box3().setFromCenterAndSize(new Vector3(), v3(part.dimensions ?? [10, 10, 10]));
  return b.applyMatrix4(instanceMatrix(inst));
}

/** Convex hull of a part's mesh (sampled), in CAD world metres; falls back to its oriented box. */
function hullDesc(R: R, part: CatalogPart, inst: { position: [number, number, number]; quaternion: [number, number, number, number] }, meshOf: (p: CatalogPart) => { triangles: Float32Array } | null) {
  const M = instanceMatrix(inst);
  const tri = meshOf(part)?.triangles;
  if (tri && tri.length >= 36) {
    const nv = tri.length / 3;
    const want = 96;
    const step = Math.max(1, Math.floor(nv / want));
    const pts: number[] = [];
    const v = new Vector3();
    // extremes along the axes first so thin parts keep their outline
    const ext = [0, 0, 0, 0, 0, 0];
    const val = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < nv; i++)
      for (let k = 0; k < 3; k++) {
        const x = tri[i * 3 + k];
        if (x < val[k * 2]) (val[k * 2] = x), (ext[k * 2] = i);
        if (x > val[k * 2 + 1]) (val[k * 2 + 1] = x), (ext[k * 2 + 1] = i);
      }
    const idx = new Set<number>(ext);
    for (let i = 0; i < nv; i += step) idx.add(i);
    // a motor's output shaft (local +Y past the face) is thin: leave it out or the hull swallows what's on it
    const motor = isMotor(part);
    for (const i of idx) {
      if (motor && tri[i * 3 + 1] > 0.5) continue;
      v.set(tri[i * 3], tri[i * 3 + 1], tri[i * 3 + 2]).applyMatrix4(M).multiplyScalar(MM);
      pts.push(v.x, v.y, v.z);
    }
    const d = R.ColliderDesc.convexHull(new Float32Array(pts));
    if (d) return d;
  }
  const b = part.bounds ? new Box3(v3(part.bounds[0]), v3(part.bounds[1])) : new Box3().setFromCenterAndSize(new Vector3(), v3(part.dimensions ?? [10, 10, 10]));
  if (isMotor(part) && b.min.y < 0) b.max.y = Math.min(b.max.y, 0);
  const s = b.getSize(new Vector3()).multiplyScalar(MM / 2).max(new Vector3(0.0005, 0.0005, 0.0005));
  const c = b.getCenter(new Vector3()).applyMatrix4(M).multiplyScalar(MM);
  const q = q4(inst.quaternion);
  return R.ColliderDesc.cuboid(s.x, s.y, s.z).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
}

const IDENT = new Matrix4();

/** Triangle mesh of a part in CAD world metres (null when there's no mesh or it's huge). */
function trimeshDesc(R: R, part: CatalogPart, inst: { position: [number, number, number]; quaternion: [number, number, number, number] }, meshOf: (p: CatalogPart) => { triangles: Float32Array } | null) {
  const tri = meshOf(part)?.triangles;
  if (!tri || tri.length < 9 || tri.length / 9 > 40000) return null;
  const M = instanceMatrix(inst);
  const nv = tri.length / 3;
  const verts = new Float32Array(tri.length);
  const v = new Vector3();
  for (let i = 0; i < nv; i++) {
    v.set(tri[i * 3], tri[i * 3 + 1], tri[i * 3 + 2]).applyMatrix4(M).multiplyScalar(MM);
    verts[i * 3] = v.x;
    verts[i * 3 + 1] = v.y;
    verts[i * 3 + 2] = v.z;
  }
  const idx = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) idx[i] = i;
  try {
    return R.ColliderDesc.trimesh(verts, idx);
  } catch {
    return null;
  }
}

/** Hull points of a part (CAD world m), sampled like hullDesc. */
function hullPoints(part: CatalogPart, inst: { position: [number, number, number]; quaternion: [number, number, number, number] }, meshOf: (p: CatalogPart) => { triangles: Float32Array } | null) {
  const M = instanceMatrix(inst);
  const tri = meshOf(part)?.triangles;
  const pts: Vector3[] = [];
  if (tri && tri.length >= 36) {
    const nv = tri.length / 3;
    const step = Math.max(1, Math.floor(nv / 64));
    for (let i = 0; i < nv; i += step) pts.push(new Vector3(tri[i * 3], tri[i * 3 + 1], tri[i * 3 + 2]).applyMatrix4(M).multiplyScalar(MM));
  } else {
    const b = part.bounds ? new Box3(v3(part.bounds[0]), v3(part.bounds[1])) : new Box3().setFromCenterAndSize(new Vector3(), v3(part.dimensions ?? [10, 10, 10]));
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new Vector3(x, y, z).applyMatrix4(M).multiplyScalar(MM));
  }
  return pts;
}

/** Convex shapes for the hard-stop check: full size (obstacle) and ~1 mm smaller (moving arm part). */
function stopShape(R: R, part: CatalogPart, inst: { position: [number, number, number]; quaternion: [number, number, number, number] }, meshOf: (p: CatalogPart) => { triangles: Float32Array } | null, owner: number) {
  if (isHardware(part)) return null;
  const pts = hullPoints(part, inst, meshOf);
  if (pts.length < 4) return null;
  const box = new Box3().setFromPoints(pts);
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3()).length();
  const k = Math.max(0.5, 1 - 0.0012 / Math.max(1e-3, size / 2));
  const make = (scale: number): StopShape | null => {
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      const q = p.clone().sub(c).multiplyScalar(scale).add(c);
      arr[i * 3] = q.x;
      arr[i * 3 + 1] = q.y;
      arr[i * 3 + 2] = q.z;
    });
    const shape = new R.ConvexPolyhedron(arr, null);
    return { shape, box: new Box3().setFromPoints(pts.map((p) => p.clone().sub(c).multiplyScalar(scale).add(c))), owner };
  };
  const full = make(1), shrunk = make(k);
  if (!full || !shrunk) return null;
  return { full, shrunk };
}

const _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _p2 = new Vector3(), _q2 = new Quaternion();
function intersects(a: StopShape, A: Matrix4, b: StopShape, B: Matrix4) {
  A.decompose(_p, _q, _s);
  B.decompose(_p2, _q2, _s);
  try {
    return a.shape.intersectsShape({ x: _p.x, y: _p.y, z: _p.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, b.shape, { x: _p2.x, y: _p2.y, z: _p2.z }, { x: _q2.x, y: _q2.y, z: _q2.z, w: _q2.w });
  } catch {
    return false;
  }
}
