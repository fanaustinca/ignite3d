// Built-in goBILDA seed catalog, generated parametrically.
// Every hole is placed on the goBILDA 8 mm grid: 14 mm bores at 24 mm pitch with
// 4×M4 on a 16 mm square around each, so parts snapped hole-to-hole stay aligned.
import type { CatalogPart, Category, Extrusion, ProceduralRecipe, SnapPoint, Vec3 } from '../types/cad';
import gobildaIndex from './gobilda.json';
import { recipeBounds, recipeVolume, snapsFromRecipe, sub3, gearPts, hexPts, dPts, norm3, cross3, scale3, add3 } from '../geometry/recipe';
import { C, bore14, circle, dHole, framed, m4, male, prism, rect, rexHole, roundHole, rrect, tappedHole, throughHole, poly } from './builders';

export const BUILTIN_CATALOG_VERSION = 3;

const DENSITY = { alu: 0.0027, steel: 0.00785, plastic: 0.00125, rubber: 0.0011 };

interface Def {
  sku: string;
  name: string;
  category: Category;
  series: string;
  recipe: ProceduralRecipe;
  /** grams; if omitted computed from volume × density */
  mass?: number;
  density?: number;
  price: number;
  mirrorSku?: string;
  tags?: string[];
}

function finish(d: Def): CatalogPart {
  const { min, max } = recipeBounds(d.recipe);
  const dims = sub3(max, min).map((x) => Math.round(x * 100) / 100) as Vec3;
  const vol = recipeVolume({ solids: d.recipe.solids.filter((s) => !s.decal) });
  const mass = d.mass ?? Math.round(vol * (d.density ?? DENSITY.alu) * 10) / 10;
  return {
    sku: d.sku,
    name: d.name,
    category: d.category,
    series: d.series,
    dimensions: dims,
    massGrams: mass,
    priceUsd: d.price,
    snapPoints: snapsFromRecipe(d.recipe),
    procedural: d.recipe,
    mirrorSku: d.mirrorSku,
    tags: d.tags,
  };
}

const pad = (n: number, w = 4) => String(Math.round(n)).padStart(w, '0');

// ---------------------------------------------------------------- hole patterns

/** Standard goBILDA channel face pattern along a face of length L (a = along, b = across, centred). */
function channelFacePattern(L: number, nCenters: number) {
  const holes = [];
  for (let k = 1; k <= nCenters; k++) holes.push({ a: -L / 2 + 24 * k, b: 0, big: true });
  for (let j = 1; j < L / 8; j++) {
    if (j % 3 === 0) continue;
    holes.push({ a: -L / 2 + 8 * j, b: -8, big: false }, { a: -L / 2 + 8 * j, b: 8, big: false });
  }
  for (let k = 0; k <= nCenters; k++) holes.push({ a: -L / 2 + 12 + 24 * k, b: 0, big: false });
  return holes;
}

function patternToHoles(p: ReturnType<typeof channelFacePattern>, flipB = false) {
  return p.map((h) => (h.big ? bore14(h.a, flipB ? -h.b : h.b) : m4(h.a, flipB ? -h.b : h.b)));
}

// ---------------------------------------------------------------- STRUCTURE

function uChannel(n: number): Def {
  const L = 24 * (n + 1);
  const t = 2.5;
  const pat = channelFacePattern(L, n);
  const solids: Extrusion[] = [
    prism('y', -24, t, rect(-L / 2, -24, L / 2, 24), { holes: pat.map((h) => (h.big ? bore14(h.a, h.b) : m4(h.a, h.b))), color: C.alu }),
    prism('z', -24, t, rect(-L / 2, -24 + t, L / 2, 24), { holes: patternToHoles(pat), color: C.alu }),
    prism('z', 24 - t, t, rect(-L / 2, -24 + t, L / 2, 24), { holes: patternToHoles(pat), color: C.alu }),
  ];
  return {
    sku: `1120-${pad(n)}-${pad(L)}`,
    name: `U-Channel, ${n} Hole (${L}mm)`,
    category: 'Structure',
    series: '1120 U-Channel',
    recipe: { solids },
    price: Math.round((3.99 + n * 1.25) * 100) / 100,
    tags: ['channel', 'u-channel', 'frame'],
  };
}

function lowSideChannel(n: number): Def {
  const L = 24 * (n + 1);
  const t = 2.5;
  const pat = channelFacePattern(L, n);
  const wallHoles = [];
  for (let j = 1; j < L / 8; j++) wallHoles.push(m4(-L / 2 + 8 * j, 0));
  const solids: Extrusion[] = [
    prism('y', -12, t, rect(-L / 2, -24, L / 2, 24), { holes: pat.map((h) => (h.big ? bore14(h.a, h.b) : m4(h.a, h.b))), color: C.alu }),
    prism('z', -24, t, rect(-L / 2, -12 + t, L / 2, 12), { holes: wallHoles, color: C.alu }),
    prism('z', 24 - t, t, rect(-L / 2, -12 + t, L / 2, 12), { holes: wallHoles, color: C.alu }),
  ];
  return {
    sku: `1121-${pad(n)}-${pad(L)}`,
    name: `Low-Side U-Channel, ${n} Hole (${L}mm)`,
    category: 'Structure',
    series: '1121 Low-Side U-Channel',
    recipe: { solids },
    price: Math.round((3.49 + n * 1.05) * 100) / 100,
    tags: ['channel', 'low side'],
  };
}

function miniChannel(n: number): Def {
  const L = 16 * (n + 1);
  const t = 2;
  const web = [];
  for (let j = 1; j < L / 8; j++) web.push(m4(-L / 2 + 8 * j, 0));
  const wall = [];
  for (let k = 1; k <= n; k++) wall.push(m4(-L / 2 + 16 * k, 0));
  const solids: Extrusion[] = [
    prism('y', -6, t, rect(-L / 2, -12, L / 2, 12), { holes: web, color: C.alu }),
    prism('z', -12, t, rect(-L / 2, -6 + t, L / 2, 6), { holes: wall, color: C.alu }),
    prism('z', 12 - t, t, rect(-L / 2, -6 + t, L / 2, 6), { holes: wall, color: C.alu }),
  ];
  return {
    sku: `1143-${pad(n)}-${pad(L)}`,
    name: `Mini Low-Side U-Channel, ${n} Hole (${L}mm)`,
    category: 'Structure',
    series: '1143 Mini Low-Side U-Channel',
    recipe: { solids },
    price: Math.round((2.99 + n * 0.7) * 100) / 100,
    tags: ['channel', 'mini'],
  };
}

function goRail(L: number): Def {
  const t = 1.5;
  const row = [];
  for (let j = 1; j < L / 8; j++) row.push(m4(-L / 2 + 8 * j, 0));
  const solids: Extrusion[] = [
    prism('y', -8, t, rect(-L / 2, -8, L / 2, 8), { holes: row, color: C.alu }),
    prism('y', 8 - t, t, rect(-L / 2, -8, L / 2, 8), { holes: row, color: C.alu }),
    prism('z', -8, t, rect(-L / 2, -8 + t, L / 2, 8 - t), { holes: row, color: C.alu }),
    prism('z', 8 - t, t, rect(-L / 2, -8 + t, L / 2, 8 - t), { holes: row, color: C.alu }),
  ];
  return {
    sku: `1109-0016-${pad(L)}`,
    name: `goRAIL 16mm Square (${L}mm)`,
    category: 'Structure',
    series: '1109 goRAIL',
    recipe: { solids },
    price: Math.round((4.99 + L * 0.02) * 100) / 100,
    tags: ['rail', 'extrusion', 'tube'],
  };
}

function flatBeam(n: number): Def {
  const L = 16 * n;
  const holes = [];
  for (let k = 0; k < n; k++) holes.push(m4(-L / 2 + 8 + 16 * k, 0));
  return {
    sku: `1102-${pad(n)}-${pad(L)}`,
    name: `Flat Beam, ${n} Hole (${L}mm)`,
    category: 'Structure',
    series: '1102 Flat Beam',
    recipe: { solids: [prism('y', 0, 3, rrect(L, 16, 2), { holes, color: C.alu })] },
    price: Math.round((1.99 + n * 0.25) * 100) / 100,
    tags: ['beam', 'flat', 'bracket'],
  };
}

function lBeam(n: number): Def {
  const L = 16 * n;
  const t = 3;
  const hz = [];
  const vt = [];
  for (let k = 0; k < n; k++) {
    hz.push(m4(-L / 2 + 8 + 16 * k, 8));
    vt.push(m4(-L / 2 + 8 + 16 * k, 8));
  }
  const solids: Extrusion[] = [
    prism('y', 0, t, rect(-L / 2, 0, L / 2, 16), { holes: hz, color: C.alu }),
    prism('z', 0, t, rect(-L / 2, t, L / 2, 16), { holes: vt, color: C.alu }),
  ];
  return {
    sku: `1103-${pad(n)}-${pad(L)}`,
    name: `L-Beam, ${n} Hole (${L}mm)`,
    category: 'Structure',
    series: '1103 L-Beam',
    recipe: { solids },
    price: Math.round((2.49 + n * 0.35) * 100) / 100,
    tags: ['beam', 'angle'],
  };
}

function gridPlate(nx: number, nz: number): Def {
  const W = 16 * nx;
  const D = 16 * nz;
  const holes = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) holes.push(m4(-W / 2 + 8 + 16 * i, -D / 2 + 8 + 16 * k));
  return {
    sku: `1117-${pad(nx * 100 + nz)}-${pad(W)}`,
    name: `Grid Plate, ${nx}×${nz} Hole (${W}×${D}mm)`,
    category: 'Structure',
    series: '1117 Grid Plate',
    recipe: { solids: [prism('y', 0, 2.5, rrect(W, D, 3), { holes, color: C.alu })] },
    price: Math.round((4.99 + nx * nz * 0.08) * 100) / 100,
    tags: ['plate', 'grid'],
  };
}

// ---------------------------------------------------------------- MOUNTS

/** Box with blind tapped holes on given faces (16mm-square patterns). */
function tappedBlock(idp: string, size: Vec3, faces: { n: Vec3; up: Vec3; pts: [number, number][] }[]) {
  const [sx, sy, sz] = size;
  const solids: Extrusion[] = [prism('y', -sy / 2, sy, rect(-sx / 2, -sz / 2, sx / 2, sz / 2), { color: C.alu })];
  const snaps: SnapPoint[] = [];
  faces.forEach((f, fi) => {
    const n = f.n;
    const up = f.up;
    const side = cross3(n, up);
    const half = Math.abs(n[0]) * sx / 2 + Math.abs(n[1]) * sy / 2 + Math.abs(n[2]) * sz / 2;
    f.pts.forEach(([a, b], pi) => {
      const pos = add3(add3(scale3(n, half), scale3(up, a)), scale3(side, b));
      const th = tappedHole(`${idp}f${fi}p${pi}`, pos, n, up);
      solids.push(th.solid);
      snaps.push(th.snap);
    });
  });
  return { solids, snaps };
}

const SQ16: [number, number][] = [
  [-8, -8],
  [8, -8],
  [8, 8],
  [-8, 8],
];

function quadBlock(): Def {
  const faces = [
    { n: [0, 1, 0] as Vec3, up: [1, 0, 0] as Vec3, pts: SQ16 },
    { n: [0, -1, 0] as Vec3, up: [1, 0, 0] as Vec3, pts: SQ16 },
    { n: [0, 0, 1] as Vec3, up: [1, 0, 0] as Vec3, pts: SQ16 },
    { n: [0, 0, -1] as Vec3, up: [1, 0, 0] as Vec3, pts: SQ16 },
  ];
  const { solids, snaps } = tappedBlock('q', [43, 24, 24], faces);
  return {
    sku: '1201-0043-0004',
    name: 'Quad Block Pattern Mount (43mm)',
    category: 'Mounts',
    series: '1201 Quad Block Pattern Mount',
    recipe: { solids, extraSnaps: snaps },
    price: 6.99,
    tags: ['block', 'mount', 'tapped'],
  };
}

function dualBlock(sides: 1 | 2): Def {
  const faces = [{ n: [0, 0, 1] as Vec3, up: [1, 0, 0] as Vec3, pts: [[-8, 0], [8, 0]] as [number, number][] }];
  if (sides === 2) faces.push({ n: [0, 0, -1], up: [1, 0, 0], pts: [[-8, 0], [8, 0]] });
  const { solids, snaps } = tappedBlock('d', [48, 16, 16], faces);
  // vertical clearance holes for mounting (through the full height)
  solids[0] = prism('y', -8, 16, rect(-24, -8, 24, 8), { holes: [m4(-20, 0), m4(20, 0)], color: C.alu });
  return {
    sku: `1202-0016-000${sides}`,
    name: `Dual Block Mount (${sides}-Side)`,
    category: 'Mounts',
    series: '1202 Dual Block Mount',
    recipe: { solids, extraSnaps: snaps },
    price: sides === 1 ? 4.99 : 5.49,
    tags: ['block', 'mount'],
  };
}

function blockMount11(): Def {
  const { solids, snaps } = tappedBlock('b', [24, 16, 16], [{ n: [0, 0, 1], up: [1, 0, 0], pts: [[4, 0]] }]);
  solids[0] = prism('y', -8, 16, rect(-12, -8, 12, 8), { holes: [m4(-4, 0)], color: C.alu });
  return {
    sku: '1203-0016-0011',
    name: 'Block Mount (1-1)',
    category: 'Mounts',
    series: '1203 Block Mount',
    recipe: { solids, extraSnaps: snaps },
    price: 3.99,
    tags: ['block', 'mount'],
  };
}

function anglePatternMount(angle: 45 | 90): Def {
  const t = 3;
  const pat = [bore14(0, 12), m4(-8, 4), m4(8, 4), m4(-8, 20), m4(8, 20)];
  const base = prism('y', 0, t, rect(-12, 0, 12, 24), { holes: [bore14(0, 12), m4(-8, 4), m4(8, 4), m4(-8, 20), m4(8, 20)], color: C.alu });
  const a = (angle * Math.PI) / 180;
  // second leaf hinged on the base's z = 0 edge, rising at `angle` from the base plane
  const vv: Vec3 = angle === 90 ? [0, 1, 0] : norm3([0, Math.sin(a), Math.cos(a)]);
  const n = cross3([1, 0, 0], vv);
  const leaf = framed(scale3(n, -t), [1, 0, 0], vv, t, rect(-12, 0, 12, 24), { holes: pat, color: C.alu });
  return {
    sku: `1209-0024-00${angle}`,
    name: `Angle Pattern Mount (${angle}°)`,
    category: 'Mounts',
    series: '1209 Angle Pattern Mount',
    recipe: { solids: [base, leaf] },
    price: 3.49,
    tags: ['gusset', 'bracket', 'angle'],
  };
}

function clampingMount(): Def {
  const holes = [roundHole(32), m4(-16, -16), m4(16, -16), m4(16, 16), m4(-16, 16)];
  return {
    sku: '1220-0032-0048',
    name: 'Clamping Mount (32mm Bore)',
    category: 'Mounts',
    series: '1220 Clamping Mount',
    recipe: { solids: [prism('z', 0, 12, rrect(48, 48, 4), { holes, color: C.alu })] },
    price: 9.99,
    tags: ['motor mount', 'clamp', 'yellow jacket'],
  };
}

function faceMountBracket(): Def {
  const t = 3;
  const face = prism('z', 0, t, rect(-24, 0, 24, 48), {
    holes: [bore14(0, 24), m4(-8, 16), m4(8, 16), m4(-8, 32), m4(8, 32), m4(-16, 8), m4(16, 8), m4(-16, 40), m4(16, 40)],
    color: C.alu,
  });
  const flange = prism('y', 0, t, rect(-24, t, 24, 27), { holes: [m4(-16, 15), m4(-8, 15), m4(8, 15), m4(16, 15)], color: C.alu });
  return {
    sku: '1215-0032-0048',
    name: 'Face-Mount Motor Bracket (32mm Bore)',
    category: 'Mounts',
    series: '1215 Face-Mount Motor Bracket',
    recipe: { solids: [face, flange] },
    price: 7.99,
    tags: ['motor mount', 'bracket'],
  };
}

function pillowBlock(dual: boolean): Def {
  const W = dual ? 72 : 48;
  const bores = dual ? [bore14(-12, 16), bore14(12, 16)] : [bore14(0, 16)];
  const bw = dual ? 48 : 24;
  const base = prism('y', 0, 4, rect(-W / 2, -8, W / 2, 8), { holes: [m4(-W / 2 + 8, 0), m4(W / 2 - 8, 0)], color: C.alu });
  const block = prism('z', -8, 16, rect(-bw / 2, 4, bw / 2, 28), { holes: bores, color: C.alu });
  return {
    sku: `1206-0014-000${dual ? 2 : 1}`,
    name: `Pillow Block, 14mm Bore (${dual ? 'Dual' : 'Single'})`,
    category: 'Mounts',
    series: '1206 Pillow Block',
    recipe: { solids: [base, block] },
    price: dual ? 7.49 : 4.99,
    tags: ['bearing block'],
  };
}

// ---------------------------------------------------------------- MOTORS & SERVOS

const YJ = [
  { rpm: 6000, ratio: '1:1', code: '0001', stages: 0, mass: 330 },
  { rpm: 1620, ratio: '3.7:1', code: '0004', stages: 1, mass: 360 },
  { rpm: 1150, ratio: '5.2:1', code: '0005', stages: 1, mass: 360 },
  { rpm: 435, ratio: '13.7:1', code: '0014', stages: 2, mass: 410 },
  { rpm: 312, ratio: '19.2:1', code: '0019', stages: 2, mass: 410 },
  { rpm: 223, ratio: '26.9:1', code: '0027', stages: 2, mass: 410 },
  { rpm: 117, ratio: '50.9:1', code: '0051', stages: 3, mass: 460 },
];

function yellowJacket(m: (typeof YJ)[number]): Def {
  const gb = 12 + 14 * m.stages;
  const solids: Extrusion[] = [
    prism('y', -gb, gb, rrect(32, 32, 3), { color: C.yellow }),
    prism('y', -gb - 4, 4, circle(16), { color: C.black }),
    prism('y', -gb - 62, 58, circle(18), { color: C.black }),
    prism('y', -gb - 70, 8, rrect(20, 14, 2, 0, 0), { color: C.black }),
    prism('y', 0, 24, poly(hexPts(8)), { color: C.steel }),
  ];
  const snaps: SnapPoint[] = [];
  SQ16.forEach(([a, b], i) => {
    const th = tappedHole(`face${i}`, [a, 0, b], [0, 1, 0], [1, 0, 0]);
    solids.push(th.solid);
    snaps.push(th.snap);
  });
  // tapped 16mm-square patterns on all four gearbox sides (only when the gearbox is long enough)
  if (gb >= 26)
    for (const n of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) {
      const up: Vec3 = [0, 1, 0];
      const side = cross3(n, up);
      SQ16.forEach(([a, b], i) => {
        const pos = add3(add3(scale3(n, 16), scale3(up, -gb / 2 + a)), scale3(side, b));
        const th = tappedHole(`side${n.join('')}_${i}`, pos, n, up);
        solids.push(th.solid);
        snaps.push(th.snap);
      });
    }
  snaps.push(male('shaft', 'rex_8mm', [0, 0, 0], [0, 1, 0], [1, 0, 0]));
  return {
    sku: `5203-2402-${m.code}`,
    name: `Yellow Jacket Motor, ${m.rpm} RPM (${m.ratio})`,
    category: 'Motors & Servos',
    series: '5203 Yellow Jacket Motor',
    recipe: { solids, extraSnaps: snaps },
    mass: m.mass,
    price: m.stages === 0 ? 39.99 : 44.99 + m.stages * 2,
    tags: ['motor', 'yellow jacket', 'dc', `${m.rpm}`],
  };
}

function dualModeServo(code: string, label: string): Def {
  const solids: Extrusion[] = [
    prism('y', 0, 36, rrect(40, 20, 1.5), { color: C.servo }),
    prism('y', 26, 2.5, rect(-27.5, -10, -20, 10), { holes: [m4(-24.5, -5), m4(-24.5, 5)], color: C.servo }),
    prism('y', 26, 2.5, rect(20, -10, 27.5, 10), { holes: [m4(24.5, -5), m4(24.5, 5)], color: C.servo }),
    prism('y', 36, 2, circle(6, -10, 0), { color: C.servo }),
    prism('y', 38, 4, circle(2.9, -10, 0), { color: C.brass }),
  ];
  return {
    sku: `2000-0025-000${code}`,
    name: `Dual Mode Servo (25-${code} ${label})`,
    category: 'Motors & Servos',
    series: '2000 Dual Mode Servo',
    recipe: { solids, extraSnaps: [{ id: 'spline', type: 'hub_pattern_16mm', position: [-10, 42, 0], normal: [0, 1, 0], upVector: [1, 0, 0], depth: 0 }] },
    mass: 70,
    price: code === '2' ? 34.99 : code === '3' ? 34.99 : 39.99,
    tags: ['servo', '25t spline'],
  };
}

function servoBlock(): Def {
  const t = 4;
  const base = prism('y', 0, t, rrect(43, 32, 2), {
    holes: [bore14(0, 0), m4(-8, -8), m4(8, -8), m4(8, 8), m4(-8, 8), m4(-16, -8), m4(16, -8), m4(16, 8), m4(-16, 8)],
    color: C.alu,
  });
  const body = prism('y', t, 38, rrect(40, 20, 1.5), { color: C.servo });
  return {
    sku: '3217-0043-0025',
    name: 'Compact ServoBlock (43mm, H25T)',
    category: 'Motors & Servos',
    series: '3217 ServoBlock',
    recipe: { solids: [base, body] },
    mass: 125,
    price: 29.99,
    tags: ['servo', 'servoblock'],
  };
}

// ---------------------------------------------------------------- SHAFTS & HUBS

function rexShaft(L: number): Def {
  return {
    sku: `2106-0008-${pad(L)}`,
    name: `8mm REX Shaft, Stainless (${L}mm)`,
    category: 'Shafts & Hubs',
    series: '2106 REX Shaft',
    recipe: {
      solids: [prism('y', -L / 2, L, poly(hexPts(8)), { color: C.steel })],
      extraSnaps: [male('endA', 'rex_8mm', [0, -L / 2, 0], [0, 1, 0]), male('endB', 'rex_8mm', [0, L / 2, 0], [0, -1, 0])],
    },
    density: DENSITY.steel,
    price: Math.round((2.99 + L * 0.015) * 100) / 100,
    tags: ['shaft', 'rex', 'axle'],
  };
}

function dShaft(L: number): Def {
  return {
    sku: `2101-0006-${pad(L)}`,
    name: `6mm D-Shaft (${L}mm)`,
    category: 'Shafts & Hubs',
    series: '2101 D-Shaft',
    recipe: {
      solids: [prism('y', -L / 2, L, poly(dPts(6)), { color: C.steel })],
      extraSnaps: [male('endA', 'd_6mm', [0, -L / 2, 0], [0, 1, 0]), male('endB', 'd_6mm', [0, L / 2, 0], [0, -1, 0])],
    },
    density: DENSITY.steel,
    price: Math.round((1.99 + L * 0.012) * 100) / 100,
    tags: ['shaft', 'axle'],
  };
}

/** goBILDA hubs have THREADED 16mm-pattern holes; gears/pulleys have clearance holes. */
const HUBPAT = (snap: 'hub_pattern_16mm' | 'm4_hole' = 'hub_pattern_16mm', tapped = false) => SQ16.map(([x, y]) => m4(x, y, tapped, snap));

function sonicHub(bore: 'rex' | 'd'): Def {
  const bh = bore === 'rex' ? rexHole(0, 0, 'none') : dHole(0, 0, 'none');
  const t = 6;
  const solids = [
    prism('y', 0, t, circle(16), { holes: [...HUBPAT('hub_pattern_16mm', true), bh], color: C.alu }),
    prism('y', t, 6, circle(9), { holes: [bh], color: C.alu }),
  ];
  const type = bore === 'rex' ? 'rex_8mm' : 'd_6mm';
  return {
    sku: `1309-0016-${bore === 'rex' ? '0008' : '0006'}`,
    name: `Sonic Hub (${bore === 'rex' ? '8mm REX' : '6mm D'} Bore)`,
    category: 'Shafts & Hubs',
    series: '1309 Sonic Hub',
    recipe: { solids, extraSnaps: throughHole('bore', type, [0, 0, 0], [0, 12, 0]) },
    price: 6.99,
    tags: ['hub'],
  };
}

function hyperHub(): Def {
  const bh = rexHole(0, 0, 'none');
  const solids = [
    prism('y', 0, 4, circle(16), { holes: [...HUBPAT('hub_pattern_16mm', true), bh], color: C.alu }),
    prism('y', 4, 10, circle(9), { holes: [bh], color: C.alu }),
  ];
  return {
    sku: '1310-0016-0008',
    name: 'Hyper Hub (8mm REX Bore)',
    category: 'Shafts & Hubs',
    series: '1310 Hyper Hub',
    recipe: { solids, extraSnaps: throughHole('bore', 'rex_8mm', [0, 0, 0], [0, 14, 0]) },
    price: 7.99,
    tags: ['hub'],
  };
}

function collar(rex: boolean): Def {
  return {
    sku: `2910-0008-000${rex ? 1 : 2}`,
    name: `Clamping Shaft Collar (8mm ${rex ? 'REX' : 'Round'} Bore)`,
    category: 'Shafts & Hubs',
    series: '2910 Shaft Collar',
    recipe: { solids: [prism('y', 0, 9, circle(11), { holes: [rex ? rexHole() : roundHole(8, 0, 0, 'rex_8mm')], color: C.black })] },
    price: 3.99,
    tags: ['collar'],
  };
}

function flangedBearing(kind: 'rex' | 'round' | 'reducer'): Def {
  const id = kind === 'rex' ? rexHole(0, 0, 'none') : kind === 'round' ? roundHole(8) : roundHole(4.3);
  const fType = kind === 'reducer' ? 'm4_hole' : 'rex_8mm';
  const color = kind === 'reducer' ? C.alu : C.steel;
  const solids = [
    prism('y', 0, 1.2, circle(8), { holes: [id], color }),
    prism('y', -4, 4, circle(7), { holes: [id], color }),
  ];
  const meta = {
    rex: { sku: '1611-0514-4008', name: 'Flanged Ball Bearing (8mm REX ID × 14mm OD)', series: '1611 Flanged Bearing', price: 4.49 },
    round: { sku: '1601-0514-4008', name: 'Flanged Ball Bearing (8mm Round ID × 14mm OD)', series: '1601 Flanged Bearing', price: 3.99 },
    reducer: { sku: '2904-0014-0004', name: 'Hole Reducer (4mm ID × 14mm OD)', series: '2904 Hole Reducer', price: 1.49 },
  }[kind];
  return {
    ...meta,
    category: 'Shafts & Hubs',
    recipe: {
      solids,
      extraSnaps: [male('flange', 'bearing_14mm', [0, 0, 0], [0, -1, 0]), ...throughHole('id', fType, [0, -4, 0], [0, 1.2, 0])],
    },
    density: DENSITY.steel,
    tags: ['bearing'],
  };
}

// ---------------------------------------------------------------- GEARS, PULLEYS & SLIDES

function hubGear(N: number): Def {
  const m = 0.8;
  const root = (N * m) / 2 - 1.25 * m;
  const usePattern = root >= 14.6;
  const holes = usePattern ? [...HUBPAT(), bore14()] : [rexHole()];
  return {
    sku: `2302-0008-${pad(N)}`,
    name: `Aluminum Hub Gear, MOD 0.8, ${N}T`,
    category: 'Gears & Slides',
    series: '2302 Hub Gear',
    recipe: { solids: [prism('y', 0, 6, poly(gearPts(N, m)), { holes, color: C.alu })] },
    price: Math.round((7.99 + N * 0.08) * 100) / 100,
    tags: ['gear', 'mod 0.8', `${N}t`],
  };
}

function pinion(N: number): Def {
  return {
    sku: `2303-0008-${pad(N)}`,
    name: `Steel Pinion Gear, MOD 0.8, ${N}T (8mm REX)`,
    category: 'Gears & Slides',
    series: '2303 Pinion Gear',
    recipe: { solids: [prism('y', 0, 8, poly(gearPts(N, 0.8)), { holes: [rexHole()], color: C.steel })] },
    density: DENSITY.steel,
    price: Math.round((8.99 + N * 0.1) * 100) / 100,
    tags: ['gear', 'pinion', `${N}t`],
  };
}

function bevel(N: number, label: string, sku: string): Def {
  const mod = 1;
  const r = (N * mod) / 2;
  const steps = [1, 0.85, 0.7];
  const solids = steps.map((s, i) =>
    prism('y', i * 3, 3, poly(gearPts(N, mod).map(([x, y]) => [x * Math.max(s, 7 / (r - 1.25 * mod)), y * Math.max(s, 7 / (r - 1.25 * mod))] as [number, number])), { holes: [rexHole(0, 0, 'none')], color: C.steel }),
  );
  solids.push(prism('y', 9, 5, circle(Math.max(6.5, r * 0.45)), { holes: [rexHole(0, 0, 'none')], color: C.steel }));
  return {
    sku,
    name: `Bevel Gear ${N}T (${label}, 8mm REX)`,
    category: 'Gears & Slides',
    series: '2320 Bevel / Miter Gear',
    recipe: { solids, extraSnaps: throughHole('bore', 'rex_8mm', [0, 0, 0], [0, 14, 0]) },
    density: DENSITY.steel,
    price: 12.99,
    tags: ['bevel', 'miter', 'gear'],
  };
}

function htdPulley(N: number): Def {
  const pr = (5 * N) / (2 * Math.PI);
  const mod = (2 * pr) / N;
  const root = pr - 1.25 * mod;
  const holes = root >= 14.6 ? [...HUBPAT('hub_pattern_16mm'), bore14()] : [rexHole()];
  const body = 15;
  const flangeHoles = holes.map((h) => ({ ...h, snap: 'none' as const }));
  const solids = [
    prism('y', 0, 1.2, circle(pr + 2.5), { holes: flangeHoles, color: C.alu }),
    prism('y', 1.2, body, poly(gearPts(N, mod)), { holes: flangeHoles, color: C.alu }),
    prism('y', 1.2 + body, 1.2, circle(pr + 2.5), { holes: flangeHoles, color: C.alu }),
  ];
  const total = body + 2.4;
  const extra: SnapPoint[] = [];
  holes.forEach((h, i) => {
    if (h.snap && h.snap !== 'none') extra.push(...throughHole(`p${i}`, h.snap, [h.x, 0, h.y], [h.x, total, h.y]));
  });
  return {
    sku: `3408-0005-${pad(N)}`,
    name: `HTD 5mm Timing Pulley, ${N}T`,
    category: 'Gears & Slides',
    series: '3408 HTD 5mm Pulley',
    recipe: { solids, extraSnaps: extra },
    price: Math.round((8.99 + N * 0.12) * 100) / 100,
    tags: ['pulley', 'belt', 'htd'],
  };
}

function viperSlide(stages: number, L: number): Def {
  const solids: Extrusion[] = [];
  for (let i = 0; i < stages; i++) {
    const h = 11 - 1.5 * i;
    const holes = [];
    if (i === 0) for (let k = 0; k < L / 16; k++) holes.push(m4(-L / 2 + 8 + 16 * k, 0));
    solids.push(prism('z', i * 6, 5, rect(-L / 2 + i * 2, -h, L / 2 - i * 2, h), { holes, color: i % 2 ? C.aluDark : C.alu }));
  }
  return {
    sku: `3205-000${stages}-${pad(L)}`,
    name: `Viper-Slide Kit, ${stages}-Stage (${L}mm)`,
    category: 'Gears & Slides',
    series: '3205 Viper-Slide',
    recipe: { solids },
    price: stages === 2 ? 59.99 : stages === 3 ? 79.99 : 99.99,
    tags: ['slide', 'linear', 'viper', 'lift'],
  };
}

// ---------------------------------------------------------------- WHEELS

/** Hub plates on both outer faces, with 16mm pattern + 14mm bore. Axis is X. */
function wheelHubs(W: number, r: number, color: string) {
  const holes = [...SQ16.map(([y, z]) => m4(y, z)), bore14()];
  return [
    prism('x', -W / 2, 4, circle(r), { holes, color }),
    prism('x', W / 2 - 4, 4, circle(r), { holes, color }),
  ];
}

function rollersAround(R: number, rr: number, len: number, count: number, tilt: number, xOff = 0, phase = 0) {
  const solids: Extrusion[] = [];
  for (let i = 0; i < count; i++) {
    const th = phase + (i / count) * Math.PI * 2;
    const radial: Vec3 = [0, Math.cos(th), Math.sin(th)];
    const tang: Vec3 = [0, -Math.sin(th), Math.cos(th)];
    const a = norm3(add3(scale3(tang, Math.cos(tilt)), scale3([1, 0, 0], Math.sin(tilt))));
    const v = cross3(a, radial);
    const c: Vec3 = add3(scale3(radial, R), [xOff, 0, 0]);
    solids.push(framed(add3(c, scale3(a, -len / 2)), radial, v, len, circle(rr), { color: C.roller }));
  }
  return solids;
}

function mecanum(D: 96 | 104, side: 'Left' | 'Right'): Def {
  const W = D === 96 ? 38 : 42;
  const R = D / 2;
  const tilt = (side === 'Left' ? 1 : -1) * (Math.PI / 4);
  const solids = [
    ...wheelHubs(W, R - 16, C.black),
    prism('x', -W / 2 + 4, W - 8, circle(R - 18), { color: C.black }),
    ...rollersAround(R - 6.5, 6.5, W * 0.95, 10, tilt),
  ];
  const sku = `3625-${side === 'Left' ? '0001' : '0002'}-${pad(D)}`;
  return {
    sku,
    name: `GripForce Mecanum Wheel ${D}mm (${side})`,
    category: 'Wheels',
    series: '3625 Mecanum Wheel',
    recipe: { solids },
    mass: D === 96 ? 260 : 300,
    price: D === 96 ? 34.99 : 39.99,
    mirrorSku: `3625-${side === 'Left' ? '0002' : '0001'}-${pad(D)}`,
    tags: ['mecanum', 'wheel', 'drivetrain'],
  };
}

function gecko(D: number): Def {
  const W = D === 48 ? 24 : 30;
  const R = D / 2;
  const holes = D >= 72 ? [rexHole(), ...SQ16.map(([y, z]) => m4(y, z))] : [rexHole()];
  const tread = gearPts(Math.round(D * 0.5), (2 * (R - 1)) / Math.round(D * 0.5));
  return {
    sku: `3613-0001-${pad(D)}`,
    name: `GripForce Gecko Wheel (${D}mm)`,
    category: 'Wheels',
    series: '3613 Gecko Wheel',
    recipe: { solids: [prism('x', -W / 2, W, poly(tread), { holes, color: C.rubber })] },
    mass: Math.round(D * 1.2),
    price: Math.round((9.99 + D * 0.08) * 100) / 100,
    tags: ['wheel', 'gecko', 'intake'],
  };
}

function rhino(D: number): Def {
  const W = 30;
  const R = D / 2;
  return {
    sku: `3615-0001-${pad(D)}`,
    name: `Rhino Traction Wheel (${D}mm)`,
    category: 'Wheels',
    series: '3615 Traction Wheel',
    recipe: {
      solids: [
        ...wheelHubs(W, R - 12, C.black),
        prism('x', -W / 2 + 4, W - 8, poly(gearPts(30, (2 * (R - 1.5)) / 30)), { color: C.rubber }),
      ],
    },
    mass: D === 72 ? 120 : 180,
    price: D === 72 ? 14.99 : 17.99,
    tags: ['wheel', 'traction', 'drivetrain'],
  };
}

function omni(): Def {
  const W = 34;
  const R = 48;
  const solids = [
    ...wheelHubs(W, R - 14, C.black),
    prism('x', -W / 2 + 4, W - 8, circle(R - 16), { color: C.black }),
    ...rollersAround(R - 6, 6, 12, 10, 0, -8),
    ...rollersAround(R - 6, 6, 12, 10, 0, 8, Math.PI / 10),
  ];
  return {
    sku: '3601-0001-0096',
    name: 'Omni Wheel (96mm)',
    category: 'Wheels',
    series: '3601 Omni Wheel',
    recipe: { solids },
    mass: 200,
    price: 24.99,
    tags: ['omni', 'wheel'],
  };
}

// ---------------------------------------------------------------- FASTENERS & SPACERS

function shcs(L: number): Def {
  return {
    sku: `2800-0004-${pad(L)}`,
    name: `M4 × ${L}mm Socket Head Cap Screw`,
    category: 'Fasteners & Spacers',
    series: '2800 M4 SHCS',
    recipe: {
      solids: [
        prism('y', -L, L, circle(1.95), { color: C.oxide }),
        prism('y', 0, 4, circle(3.5), { holes: [{ x: 0, y: 0, d: 3, shape: 'rex', snap: 'none' }], color: C.oxide }),
      ],
      extraSnaps: [male('underhead', 'm4_hole', [0, 0, 0], [0, -1, 0])],
    },
    density: DENSITY.steel,
    price: Math.round((0.15 + L * 0.004) * 100) / 100,
    tags: ['screw', 'bolt', 'shcs', `m4x${L}`],
  };
}

function bhcs(L: number): Def {
  return {
    sku: `2802-0004-${pad(L)}`,
    name: `M4 × ${L}mm Button Head Screw`,
    category: 'Fasteners & Spacers',
    series: '2802 M4 Button Head',
    recipe: {
      solids: [
        prism('y', -L, L, circle(1.95), { color: C.oxide }),
        prism('y', 0, 1.4, circle(3.8), { color: C.oxide }),
        prism('y', 1.4, 0.8, circle(2.8), { holes: [{ x: 0, y: 0, d: 2.5, shape: 'rex', snap: 'none' }], color: C.oxide }),
      ],
      extraSnaps: [male('underhead', 'm4_hole', [0, 0, 0], [0, -1, 0])],
    },
    density: DENSITY.steel,
    price: Math.round((0.18 + L * 0.004) * 100) / 100,
    tags: ['screw', 'bolt', 'button', `m4x${L}`],
  };
}

export const NUT_HEIGHT = 5;
function locknut(): Def {
  return {
    sku: '2810-0004-0001',
    name: 'M4 Nylon-Insert Locknut',
    category: 'Fasteners & Spacers',
    series: '2810 M4 Locknut',
    recipe: { solids: [prism('y', 0, NUT_HEIGHT, poly(hexPts(7)), { holes: [{ x: 0, y: 0, d: 4, snap: 'm4_hole', tapped: true }], color: C.oxide })] },
    density: DENSITY.steel,
    price: 0.12,
    tags: ['nut', 'nyloc'],
  };
}

function washer(): Def {
  return {
    sku: '2801-0004-0001',
    name: 'M4 Washer',
    category: 'Fasteners & Spacers',
    series: '2801 M4 Washer',
    recipe: { solids: [prism('y', 0, 0.8, circle(4.5), { holes: [m4(0, 0)], color: C.steel })] },
    density: DENSITY.steel,
    price: 0.05,
    tags: ['washer'],
  };
}

function standoff(L: number): Def {
  return {
    sku: `1501-0006-${pad(L)}`,
    name: `M4 Standoff, 6mm OD (${L}mm)`,
    category: 'Fasteners & Spacers',
    series: '1501 M4 Standoff',
    recipe: { solids: [prism('y', 0, L, circle(3), { holes: [{ x: 0, y: 0, d: 3.3, snap: 'm4_hole', tapped: true }], color: C.alu })] },
    price: Math.round((0.59 + L * 0.01) * 100) / 100,
    tags: ['standoff', 'spacer'],
  };
}

function patternSpacer(T: number): Def {
  return {
    sku: `1503-0043-${pad(T)}`,
    name: `Pattern Spacer, 4-Hole (${T}mm)`,
    category: 'Fasteners & Spacers',
    series: '1503 Pattern Spacer',
    recipe: { solids: [prism('y', 0, T, rrect(24, 24, 3), { holes: [bore14(), ...SQ16.map(([x, y]) => m4(x, y))], color: C.alu })] },
    price: Math.round((1.49 + T * 0.08) * 100) / 100,
    tags: ['spacer'],
  };
}

function shaftSpacer(T: number): Def {
  return {
    sku: `1506-0814-${pad(T)}`,
    name: `Shaft Spacer, 8mm ID × 14mm OD (${T}mm)`,
    category: 'Fasteners & Spacers',
    series: '1506 Shaft Spacer',
    recipe: { solids: [prism('y', 0, T, circle(7), { holes: [roundHole(8.1, 0, 0, 'rex_8mm')], color: C.alu })] },
    price: Math.round((0.39 + T * 0.05) * 100) / 100,
    tags: ['spacer', 'shaft'],
  };
}

function screwSpacer(T: number): Def {
  return {
    sku: `1508-0408-${pad(T)}`,
    name: `Screw Spacer, 4mm ID × 8mm OD (${T}mm)`,
    category: 'Fasteners & Spacers',
    series: '1508 Screw Spacer',
    recipe: { solids: [prism('y', 0, T, circle(4), { holes: [m4(0, 0)], color: C.alu })] },
    price: Math.round((0.29 + T * 0.04) * 100) / 100,
    tags: ['spacer', 'screw'],
  };
}

// ---------------------------------------------------------------- assemble

export const SCREW_LENGTHS = [6, 8, 10, 12, 14, 16, 20, 25, 30, 40];

function buildCatalog(): CatalogPart[] {
  const defs: Def[] = [];
  for (let n = 1; n <= 17; n++) defs.push(uChannel(n));
  for (const n of [1, 2, 3, 5, 7, 11, 15, 17]) defs.push(lowSideChannel(n));
  for (const n of [2, 4, 6, 8, 10]) defs.push(miniChannel(n));
  for (const L of [96, 144, 192, 240, 288, 336, 384, 432]) defs.push(goRail(L));
  for (const n of [3, 5, 7, 9, 11]) defs.push(flatBeam(n));
  for (const n of [3, 5, 7, 9, 11]) defs.push(lBeam(n));
  defs.push(gridPlate(5, 5), gridPlate(5, 11), gridPlate(11, 11));

  defs.push(quadBlock(), dualBlock(1), dualBlock(2), blockMount11(), anglePatternMount(45), anglePatternMount(90));
  defs.push(clampingMount(), faceMountBracket(), pillowBlock(false), pillowBlock(true));

  YJ.forEach((m) => defs.push(yellowJacket(m)));
  defs.push(dualModeServo('2', 'Torque'), dualModeServo('3', 'Speed'), dualModeServo('4', 'Super Speed'), servoBlock());

  for (const L of [40, 60, 80, 96, 120, 160, 240, 300]) defs.push(rexShaft(L));
  for (const L of [48, 72, 96, 120]) defs.push(dShaft(L));
  defs.push(sonicHub('rex'), sonicHub('d'), hyperHub(), collar(true), collar(false));
  defs.push(flangedBearing('rex'), flangedBearing('round'), flangedBearing('reducer'));

  for (const N of [32, 40, 48, 64, 72, 80, 96, 100]) defs.push(hubGear(N));
  for (const N of [16, 20, 24, 32]) defs.push(pinion(N));
  defs.push(bevel(20, '1:1 Miter', '2320-0008-0020'), bevel(15, '2:1 Pinion', '2320-0008-0015'), bevel(30, '2:1 Gear', '2320-0008-0030'));
  for (const N of [16, 24, 32, 48]) defs.push(htdPulley(N));
  defs.push(viperSlide(2, 336), viperSlide(3, 336), viperSlide(4, 240), viperSlide(4, 336));

  defs.push(mecanum(96, 'Left'), mecanum(96, 'Right'), mecanum(104, 'Left'), mecanum(104, 'Right'));
  for (const D of [48, 72, 96]) defs.push(gecko(D));
  defs.push(rhino(72), rhino(96), omni());

  for (const L of SCREW_LENGTHS) defs.push(shcs(L));
  for (const L of [8, 10, 12, 16]) defs.push(bhcs(L));
  defs.push(locknut(), washer());
  for (const L of [6, 8, 12, 16, 20, 24, 32, 40, 43, 48]) defs.push(standoff(L));
  for (const T of [4, 8, 12, 16]) defs.push(patternSpacer(T));
  for (const T of [1, 2, 4, 8, 16]) defs.push(shaftSpacer(T));
  for (const T of [1, 2, 4, 6, 8, 12]) defs.push(screwSpacer(T));

  return defs.map(finish);
}

/** Ignite3D's parametric models (fallback geometry + logic tests). */
export const PROCEDURAL_CATALOG: CatalogPart[] = buildCatalog();

/**
 * Real goBILDA catalogue (generated from goBILDA's STEP files, see ignite3d-assets/build_catalog.py).
 * Snap points are loaded per part on demand; a parametric model (when one exists for the SKU) is kept as
 * instant fallback geometry while the real mesh loads.
 */
const REAL = gobildaIndex as CatalogPart[];
const procBySku = new Map(PROCEDURAL_CATALOG.map((p) => [p.sku, p]));
export const USING_REAL_CATALOG = REAL.length > 0;
export const BUILTIN_CATALOG: CatalogPart[] = USING_REAL_CATALOG
  ? REAL.map((p) => ({ ...p, snapPoints: [], procedural: undefined, tags: procBySku.get(p.sku)?.tags }))
  : PROCEDURAL_CATALOG;

export const shcsSku = (L: number) => `2800-0004-${pad(L)}`;
export const LOCKNUT_SKU = USING_REAL_CATALOG ? '2812-0004-0007' : '2810-0004-0001';

