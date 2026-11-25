import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { PROCEDURAL_CATALOG } from '../../data/catalog';
import { buildExampleRobot } from '../example';
import { proceduralVisual, visualTriangles } from '../../services/assetLoader';
import { findCollisions, clearCollisionCache } from './collide';
import { analyzeStructure } from './strength';
import { planJointFasteners } from '../../store/useCadStore';
import type { CatalogPart, PlacedInstance } from '../../types/cad';

const cat = Object.fromEntries(PROCEDURAL_CATALOG.map((p) => [p.sku, p]));
const tri = new Map<string, Float32Array>();
const meshOf = (p: CatalogPart) => {
  if (!tri.has(p.sku)) tri.set(p.sku, visualTriangles(proceduralVisual(p)));
  return { triangles: tri.get(p.sku)! };
};
const inst = (id: string, sku: string, pos: [number, number, number], q = new Quaternion()): PlacedInstance => ({
  instanceId: id,
  sku,
  position: pos,
  quaternion: [q.x, q.y, q.z, q.w],
  hidden: false,
  ghosted: false,
});
const channels = Object.keys(cat).filter((k) => k.startsWith('1120-')).sort((a, b) => cat[a].dimensions![0] - cat[b].dimensions![0]);
const channel = channels.find((k) => cat[k].dimensions![0] > 200)!;
const longest = channels[channels.length - 1];

describe('collision detection', () => {
  it('flags two channels pushed into each other, not two channels side by side', async () => {
    clearCollisionCache();
    const h = cat[channel].dimensions![1];
    const into = await findCollisions([inst('a', channel, [0, 0, 0]), inst('b', channel, [0, h / 2, 0])], cat, meshOf);
    expect(into.collisions.length).toBe(1);
    expect(into.collisions[0].depth).toBeGreaterThan(0.4);
    const crossed = await findCollisions(
      [inst('a', channel, [0, 0, 0]), inst('c', channel, [0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))],
      cat,
      meshOf,
    );
    expect(crossed.collisions.length).toBe(1);
    const apart = await findCollisions([inst('a', channel, [0, 0, 0]), inst('d', channel, [0, 0, cat[channel].dimensions![2] + 0.001])], cat, meshOf);
    expect(apart.collisions.length).toBe(0);
  });

  it('two stacked channels fastened by Smart Fasten (screws + lock nuts) do not collide', async () => {
    clearCollisionCache();
    const h = cat[channel].dimensions![1];
    const base = [inst('a', channel, [0, 0, 0]), inst('b', channel, [0, -h, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI))];
    const { added } = planJointFasteners(base, cat, null, 4);
    expect(added.length).toBeGreaterThanOrEqual(4);
    const r = await findCollisions([...base, ...added], cat, meshOf);
    expect(r.collisions.map((c) => `${c.skuA}×${c.skuB} ${c.depth.toFixed(2)}mm n=${c.samples}`)).toEqual([]);
    const rep = analyzeStructure([...base, ...added], cat, meshOf);
    expect(rep.score.joints).toBe(1);
    expect(rep.score.fastened).toBe(1);
    expect(rep.issues.filter((i) => i.kind === 'screw')).toEqual([]);
  });
});

describe('structure & stability check', () => {
  it('example drivetrain: every joint fastened, everything attached, stable', () => {
    const robot = buildExampleRobot(cat);
    const rep = analyzeStructure(robot, cat, meshOf);
    expect(rep.issues.filter((i) => i.level === 'error' || i.level === 'warn').map((i) => `${i.title}: ${i.detail}`)).toEqual([]);
    expect(rep.score.joints).toBeGreaterThanOrEqual(8);
    expect(rep.score.loose).toBe(0);
    expect(rep.score.attached).toBe(rep.score.parts);
    expect(rep.stability!.ok).toBe(true);
    expect(rep.stability!.tipAngleDeg).toBeGreaterThan(25);
  });

  it('removing screws makes joints loose / weak and the part floats', () => {
    const robot = buildExampleRobot(cat);
    const screws = robot.filter((i) => i.sku.startsWith('2800-'));
    // drop every screw of the first cross-member joint -> loose; then keep exactly one -> weak
    const rep0 = analyzeStructure(robot.filter((i) => !i.sku.startsWith('2800-')), cat);
    expect(rep0.score.loose).toBeGreaterThan(0);
    expect(rep0.issues.some((i) => i.kind === 'floating')).toBe(true);
    expect(screws.length).toBeGreaterThan(0);
  });

  it('a tall narrow tower is reported as top-heavy', () => {
    const h = cat[longest].dimensions!;
    const up = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const tower = [inst('t', longest, [0, h[0] / 2, 0], up)];
    const rep = analyzeStructure(tower, cat, meshOf);
    expect(rep.stability!.tipAngleDeg).toBeLessThan(12);
    expect(rep.issues.some((i) => i.kind === 'stability')).toBe(true);
  });
});
