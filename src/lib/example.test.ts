import { describe, expect, it } from 'vitest';
import { PROCEDURAL_CATALOG as BUILTIN_CATALOG } from '../data/catalog';
import { buildExampleRobot } from './example';
import { robotBounds, sizeCheck, massProps } from './metrics';
import { exportStep } from '../export/step';
import { bomRows, bomCsv, onshapeTransform } from '../export/files';
import { encodeBuild, decodeBuild } from './share';
import { worldSnaps } from './snap';

const cat = Object.fromEntries(BUILTIN_CATALOG.map((p) => [p.sku, p]));

describe('example drivetrain', () => {
  const robot = buildExampleRobot(cat);
  it('builds 2 rails, 2 cross members, 4 motors, 4 hubs, 4 wheels + fasteners', () => {
    const count = (p: string) => robot.filter((i) => i.sku.startsWith(p)).length;
    expect(count('1120-')).toBe(4);
    expect(count('5203-')).toBe(4);
    expect(count('1309-')).toBe(4);
    expect(count('3625-')).toBe(4);
    const screws = robot.filter((i) => i.sku.startsWith('2800-'));
    const nuts = robot.filter((i) => i.sku === '2810-0004-0001' || i.sku === '2812-0004-0007');
    // 4 rail/cross joints + 4 motor faces + 4 hub/wheel joints, up to 4 screws each
    expect(screws.length).toBe(48);
    // only the 4 cross-member joints need locknuts; motor faces and goBILDA hubs are threaded
    expect(nuts.length).toBe(16);
  });

  it('every screw shank lies on a hole axis of each part it passes through', () => {
    const holeSnaps = robot.filter((i) => !i.sku.startsWith('2800') && i.sku !== '2810-0004-0001').flatMap((i) => worldSnaps(i, cat[i.sku]));
    for (const s of robot.filter((i) => i.sku.startsWith('2800-'))) {
      const head = worldSnaps(s, cat[s.sku])[0];
      const onAxis = holeSnaps.filter((h) => {
        const d = h.pos.clone().sub(head.pos);
        const along = d.dot(head.normal);
        return d.addScaledVector(head.normal, -along).length() < 1e-3 && along >= -1e-3 && along < 30;
      });
      expect(onAxis.length, `screw ${s.sku}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('fits in the 18-inch cube and has sane mass', () => {
    const chk = sizeCheck(robotBounds(robot, cat));
    expect(chk.over).toBe(false);
    const m = massProps(robot, cat);
    expect(m.grams).toBeGreaterThan(2000);
    expect(m.cog!.y).toBeGreaterThan(0);
  });

  it('round-trips through the share link', () => {
    const back = decodeBuild(encodeBuild(robot))!;
    expect(back.length).toBe(robot.length);
    back.forEach((b, i) => {
      expect(b.sku).toBe(robot[i].sku);
      b.position.forEach((x, k) => expect(x).toBeCloseTo(robot[i].position[k], 2));
    });
  });

  it('exports STEP, BOM and Onshape transforms', () => {
    const step = exportStep(robot, cat);
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    expect((step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) ?? []).length).toBe(robot.length);
    const rows = bomRows(robot, cat);
    expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(robot.length);
    expect(bomCsv(rows).split('\n')[0]).toContain('SKU');
    const t = onshapeTransform(robot[0]);
    expect(t.length).toBe(16);
    expect(t[15]).toBe(1);
  });
});
