// Headless end-to-end suite for Ignite3D (real mouse/keyboard against the production build).
// Usage: npm run build && node tests/e2e.mjs      (CHROME_PATH overrides the browser)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4791 + Math.floor(Math.random() * 100);
const URL0 = `http://localhost:${PORT}/`;
const SHOTS = join(ROOT, 'tests/screenshots');
const DL = join(ROOT, 'tests/.downloads');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
mkdirSync(SHOTS, { recursive: true });
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const chrome =
  process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'].find((p) => existsSync(p));
const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), res()));
});

const browser = await puppeteer.launch({
  protocolTimeout: 60000,
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1600,950'],
});

// browser-wide download folder (a per-page session would reset it when that page closes)
const browserCdp = await browser.target().createCDPSession();
await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const pageErrors = [];
let page;
let fixtureGlb = null;

async function newPage({ fresh = true } = {}) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1600, height: 950 });
  p.on('pageerror', (e) => pageErrors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text());
  });
  await p.setRequestInterception(true);
  const cors = { 'Access-Control-Allow-Origin': '*' };
  p.on('request', (req) => {
    const u = req.url();
    if (u.includes('cdn.jsdelivr.net')) {
      if (u.endsWith('/parts/index.json')) return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ skus: fixtureGlb ? ['1102-0003-0048'] : [] }) });
      if (fixtureGlb && u.endsWith('/parts/1102-0003-0048.glb')) return req.respond({ status: 200, headers: cors, contentType: 'model/gltf-binary', body: fixtureGlb });
      return req.respond({ status: 404, headers: cors, body: 'not found' });
    }
    if (u.includes('github.com') || u.includes('gstatic.com')) return req.respond({ status: 404, headers: cors, body: '' });
    req.continue();
  });
  if (fresh) {
    await p.goto(URL0, { waitUntil: 'load' });
    await sleep(700); // let the app's boot effects run before wiping storage
    await p.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('ignite3d');
    });
  }
  return p;
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`  ✗ ${name}\n      ${e.stack?.split('\n').slice(0, 3).join('\n      ')}`);
    try {
      await page?.screenshot({ path: join(SHOTS, `FAIL-${name.replace(/\W+/g, '_')}.png`) });
    } catch {
      /* ignore */
    }
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}
const st = (fn, ...a) => page.evaluate(fn, ...a);
const shot = (n) => page.screenshot({ path: join(SHOTS, `${n}.png`) });
async function waitFile(re, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = readdirSync(DL).find((x) => re.test(x) && !x.endsWith('.crdownload'));
    if (f) {
      await sleep(200);
      return join(DL, f);
    }
    await sleep(150);
  }
  throw new Error(`download ${re} not found`);
}
async function frames(n = 3) {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}
async function hoverWorld(p) {
  const s = await st((q) => window.__ignite.project(q), p);
  await page.mouse.move(s.x, s.y);
  await frames(4);
  return s;
}
async function clickWorld(p) {
  const s = await hoverWorld(p);
  await page.mouse.down();
  await page.mouse.up();
  await frames(2);
  return s;
}
const count = (prefix) => st((p) => window.__ignite.store.getState().instances.filter((i) => i.sku.startsWith(p)).length, prefix);

console.log(`Ignite3D e2e — ${URL0} — chrome: ${chrome}`);

// ----------------------------------------------------------------------------------
page = await newPage();
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('[data-testid="viewport"] canvas');
await sleep(800);

await test('boots with logo, version, Spark Servos credit and first-visit help', async () => {
  assert((await page.title()) === 'Ignite3D', 'title');
  const v = await page.$eval('[data-testid="version"]', (e) => e.textContent);
  assert(v === `v${pkg.version}`, `version badge ${v} vs ${pkg.version}`);
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), 'semver x.x.x');
  const credit = await page.$eval('[data-testid="credit"]', (e) => e.textContent);
  assert(credit.includes('Made by Spark Servos'), 'credit');
  assert(await page.$('[data-testid="help-modal"]'), 'help modal on first visit');
  await shot('01-help');
  await page.keyboard.press('Escape');
  await sleep(100);
  assert(!(await page.$('[data-testid="help-modal"]')), 'help closes on Esc');
});

await test('catalog has the full goBILDA seed set and search works', async () => {
  const n = await st(() => Object.keys(window.__ignite.store.getState().catalog).length);
  assert(n >= 160, `catalog size ${n}`);
  await page.type('[data-testid="catalog-search"]', '435 rpm');
  await sleep(150);
  const rows = await page.$$eval('[data-sku]', (els) => els.map((e) => e.getAttribute('data-sku')));
  assert(rows.length === 1 && rows[0] === '5203-2402-0014', `search rows ${rows}`);
  await page.click('[data-testid="catalog-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
});

await test('places the first channel on the floor grid with a real mouse click', async () => {
  await page.click('[data-sku="1120-0005-0144"]');
  await st(() => window.__ignite.setView([0, 520, 520], [0, 0, 0]));
  await clickWorld([3, 0, -2]);
  const inst = await st(() => window.__ignite.store.getState().instances);
  assert(inst.length === 1, `instances ${inst.length}`);
  const p = inst[0].position;
  assert(Math.abs(p[1] - 24) < 1e-6, `sits on floor y=${p[1]}`);
  assert(p[0] % 8 === 0 && p[2] % 8 === 0, `grid snapped ${p}`);
  await page.keyboard.press('Escape');
});

let A, B;
await test('snaps a second channel hole-to-hole and every overlapping hole lines up', async () => {
  A = await st(() => window.__ignite.store.getState().instances[0]);
  // look at the +Z wall from the side
  await st((a) => window.__ignite.setView([a.position[0] + 60, 160, 520], [a.position[0], 30, 0]), A);
  await page.click('[data-sku="1120-0003-0096"]');
  const wall = (await st((id) => window.__ignite.worldSnaps(id), A.instanceId)).find(
    (s) => s.type === 'm4_hole' && s.normal[2] > 0.99 && Math.abs(s.pos[2] - 24) < 1e-6 && Math.abs(s.pos[0] - (A.position[0] + 8)) < 1e-6 && Math.abs(s.pos[1] - 32) < 1e-6,
  );
  assert(wall, 'target wall hole');
  await hoverWorld([wall.pos[0] + 3.3, wall.pos[1], wall.pos[2]]);
  let g = await st(() => window.__ignite.ghost());
  const dbg = await st(() => ({ hov: window.__ignite.store.getState().hovered, placing: window.__ignite.store.getState().placingSku, modal: window.__ignite.store.getState().modal }));
  assert(g.target && g.target.type === 'm4_hole', `ghost snapped to ${JSON.stringify(g)} ${JSON.stringify(dbg)} A=${JSON.stringify(A.position)} wall=${JSON.stringify(wall.pos)}`);
  await shot('03-snap-ghost');
  const q0 = g.quaternion;
  await page.keyboard.press('r');
  await frames(4);
  g = await st(() => window.__ignite.ghost());
  assert(JSON.stringify(g.quaternion) !== JSON.stringify(q0), 'R rotates the ghost');
  assert(g.target, 'still snapped after R');
  for (let i = 0; i < 3; i++) await page.keyboard.press('r'); // full turn: back to the best-aligned default
  await frames(4);
  g = await st(() => window.__ignite.ghost());
  const dq = g.quaternion.reduce((a, x, i) => a + x * q0[i], 0);
  assert(Math.abs(Math.abs(dq) - 1) < 1e-6, 'four quarter-turns return to the start');
  await page.mouse.down();
  await page.mouse.up();
  await frames(2);
  await page.keyboard.press('Escape');
  const all = await st(() => window.__ignite.store.getState().instances);
  assert(all.length === 2, `instances ${all.length}`);
  B = all[1];
  const sa = await st((id) => window.__ignite.worldSnaps(id), A.instanceId);
  const sb = await st((id) => window.__ignite.worldSnaps(id), B.instanceId);
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const shared = sb.filter((b) => sa.some((a) => d(a.pos, b.pos) < 1e-4));
  assert(shared.length >= 4, `coincident hole faces: ${shared.length}`);
  for (const b of shared) {
    const a = sa.find((x) => d(x.pos, b.pos) < 1e-4);
    const dot = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2];
    assert(dot < -0.9999, `faces flush & coaxial (dot ${dot})`);
    assert(a.type === b.type || (a.type !== 'bearing_14mm') === (b.type !== 'bearing_14mm'), 'compatible hole types');
  }
  const info = await page.$eval('[data-testid="snap-info"]', (e) => e.textContent);
  assert(/Snapped/.test(info), info);
});

await test('Smart Fasten tool: click a joint hole -> M4×10 screw + locknut through both walls', async () => {
  await page.keyboard.press('f');
  const sb = await st((id) => window.__ignite.worldSnaps(id), B.instanceId);
  const sa = await st((id) => window.__ignite.worldSnaps(id), A.instanceId);
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  // B's web faces +Z away from A; pick a B hole whose axis passes through an A hole
  const outer = sb.find((b) => b.type === 'm4_hole' && b.normal[2] > 0.99 && sa.some((a) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < 1e-4 && a.type === 'm4_hole'));
  assert(outer, 'aligned outer hole');
  await hoverWorld([outer.pos[0] + 3, outer.pos[1], outer.pos[2]]);
  await shot('04-fasten-hover');
  await page.mouse.down();
  await page.mouse.up();
  await frames(2);
  const inst = await st(() => window.__ignite.store.getState().instances);
  const screws = inst.filter((i) => i.sku.startsWith('2800-'));
  const nuts = inst.filter((i) => i.sku === '2810-0004-0001');
  assert(screws.length === 1 && nuts.length === 1, `screws ${screws.length} nuts ${nuts.length}`);
  assert(screws[0].sku === '2800-0004-0010', `screw ${screws[0].sku}`);
  assert(d(screws[0].position, outer.pos) < 1e-4, 'screw head seated on the outer face, on the hole axis');
  const nutGap = Math.abs(nuts[0].position[2] - (outer.pos[2] - 5));
  assert(nutGap < 1e-4, `nut on far face (z ${nuts[0].position[2]})`);
  void sa;
  await page.keyboard.press('Escape');
});

await test('Fasten Joint (J) adds up to 4 well-spread screws per joint, never duplicates', async () => {
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('j');
  await frames(2);
  const n1 = await count('2800-');
  assert(n1 >= 2 && n1 <= 4, `screws after J: ${n1}`);
  await page.keyboard.press('j');
  await frames(2);
  assert((await count('2800-')) === n1, 'second J adds nothing');
  await shot('05-fastened');
});

await test('undo / redo restore the design (Ctrl+Z / Ctrl+Y)', async () => {
  const before = await st(() => window.__ignite.store.getState().instances.length);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  const after = await st(() => window.__ignite.store.getState().instances.length);
  assert(after < before, `undo ${before} -> ${after}`);
  await page.keyboard.down('Control');
  await page.keyboard.press('y');
  await page.keyboard.up('Control');
  assert((await st(() => window.__ignite.store.getState().instances.length)) === before, 'redo');
});

await test('S toggles hole snapping; OFF = free placement on the grid', async () => {
  await page.keyboard.press('s');
  assert((await st(() => window.__ignite.store.getState().snapEnabled)) === false, 'snap off');
  const label = await page.$eval('[data-testid="snap-toggle"]', (e) => e.textContent);
  assert(label.includes('OFF'), label);
  await page.click('[data-sku="1120-0001-0048"]');
  await st(() => window.__ignite.setView([0, 520, 520], [0, 0, 0]));
  await hoverWorld([200, 0, 200]);
  const g = await st(() => window.__ignite.ghost());
  assert(!g.target, 'no snapping while OFF');
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  assert((await st(() => window.__ignite.store.getState().snapEnabled)) === true, 'snap back on');
});

await test('selection: click a part, H hides, Alt+H unhides, G ghosts, [ ] slides along mated axis', async () => {
  await page.keyboard.press('Escape');
  await st((id) => window.__ignite.store.getState().select([id]), B.instanceId);
  const p0 = await st((id) => window.__ignite.store.getState().instances.find((i) => i.instanceId === id).position, B.instanceId);
  await page.keyboard.press(']');
  const p1 = await st((id) => window.__ignite.store.getState().instances.find((i) => i.instanceId === id).position, B.instanceId);
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  assert(Math.abs(moved - 1) < 1e-6, `] moved ${moved}`);
  await page.keyboard.press('[');
  await page.keyboard.press('g');
  assert(await st((id) => window.__ignite.store.getState().instances.find((i) => i.instanceId === id).ghosted, B.instanceId), 'ghosted');
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  assert(await st((id) => window.__ignite.store.getState().instances.find((i) => i.instanceId === id).hidden, B.instanceId), 'hidden');
  await page.keyboard.down('Alt');
  await page.keyboard.press('h');
  await page.keyboard.up('Alt');
  assert(!(await st((id) => window.__ignite.store.getState().instances.find((i) => i.instanceId === id).hidden, B.instanceId)), 'unhidden');
  // click-select through the real raycaster
  await st(() => window.__ignite.store.getState().select([]));
  await st((a) => window.__ignite.setView([a.position[0], 400, 420], [a.position[0], 0, 0]), A);
  await clickWorld([A.position[0] + 40, A.position[1] - 21.5, A.position[2]]);
  const sel = await st(() => window.__ignite.store.getState().selection);
  assert(sel.length === 1, `click selected ${sel.length}`);
  assert(await page.$('[data-testid="sel-name"]'), 'inspector shows part');
  await shot('06-selected');
});

await test('example drivetrain: 80 parts, 48 screws, all screws on hole axes, fits 18" cube', async () => {
  await st(() => window.__ignite.store.getState().clearScene());
  await page.click('[data-testid="open-help"]');
  await page.click('[data-testid="help-example"]');
  await sleep(400);
  assert((await st(() => window.__ignite.store.getState().instances.length)) === 80, 'instances');
  assert((await count('2800-')) === 48, 'screws');
  await page.keyboard.press('b');
  await page.keyboard.press('c');
  await sleep(300);
  const label = await page.$eval('[data-testid="sizing-label"]', (e) => e.textContent);
  assert(/fits/.test(label), label);
  await st(() => window.__ignite.fit());
  await sleep(400);
  await shot('07-example-dark');
});

await test('18" cube turns red when the robot is too big', async () => {
  await st(() => window.__ignite.store.getState().addInstance({ sku: '1109-0016-0432', position: [120, 200, 0], quaternion: [0, 0, 0, 1] }));
  await sleep(200);
  const label = await page.$eval('[data-testid="sizing-label"]', (e) => e.textContent);
  assert(/OVER/.test(label), label);
  await shot('08-oversize');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.keyboard.press('b');
  await page.keyboard.press('c');
});

await test('mirror swaps mecanum Left <-> Right', async () => {
  const left = await st(() => window.__ignite.store.getState().instances.find((i) => i.sku === '3625-0001-0096'));
  await st((id) => window.__ignite.store.getState().select([id]), left.instanceId);
  await page.keyboard.press('m');
  const last = await st(() => window.__ignite.store.getState().instances.at(-1));
  assert(last.sku === '3625-0002-0096', `mirrored sku ${last.sku}`);
  assert(Math.abs(last.position[0] + left.position[0]) < 1e-6, 'mirrored across X');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
});

await test('BOM groups SKUs and downloads a CSV', async () => {
  await page.click('[data-testid="open-bom"]');
  const rows = await page.$$eval('[data-testid="bom-table"] tbody tr', (r) => r.length);
  const skus = await st(() => new Set(window.__ignite.store.getState().instances.map((i) => i.sku)).size);
  assert(rows === skus, `rows ${rows} vs skus ${skus}`);
  await shot('09-bom');
  await page.click('[data-testid="bom-csv"]');
  const f = await waitFile(/bom\.csv$/);
  const csv = readFileSync(f, 'utf8').trim().split('\n');
  assert(csv[0].startsWith('SKU,Name'), csv[0]);
  assert(csv.at(-1).startsWith('TOTAL,,,80'), csv.at(-1));
  await page.keyboard.press('Escape');
});

let stepFile;
await test('exports STEP (Onshape), STL, GLB and JSON manifest', async () => {
  await page.click('[data-testid="open-export"]');
  await shot('10-export');
  await page.click('[data-testid="export-step"]');
  stepFile = await waitFile(/\.step$/);
  const step = readFileSync(stepFile, 'utf8');
  assert(step.startsWith('ISO-10303-21;') && step.trim().endsWith('END-ISO-10303-21;'), 'STEP envelope');
  assert((step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length === 80, 'one occurrence per part');
  assert(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(step), 'millimetres');
  assert(/CYLINDRICAL_SURFACE/.test(step), 'true cylindrical holes');
  await page.click('[data-testid="export-stl"]');
  const stl = readFileSync(await waitFile(/\.stl$/));
  const tris = stl.readUInt32LE(80);
  assert(stl.length === 84 + tris * 50 && tris > 10000, `binary STL ${tris} tris`);
  await page.click('[data-testid="export-glb"]');
  const glb = readFileSync(await waitFile(/\.glb$/));
  assert(glb.toString('ascii', 0, 4) === 'glTF', 'GLB magic');
  await page.click('[data-testid="export-json"]');
  const man = JSON.parse(readFileSync(await waitFile(/\.ignite3d\.json$/), 'utf8'));
  assert(man.occurrences.length === 80 && man.occurrences[0].onshapeTransform.length === 16, 'manifest transforms');
  assert(man.app === 'ignite3d' && man.version === pkg.version, 'manifest header');
  await page.keyboard.press('Escape');
});

await test('STEP file validates in OpenCascade (assembly, solids, placements)', async () => {
  const py = process.env.OCCT_PYTHON || join(process.env.HOME || '', 'miniforge3/envs/occt/bin/python');
  if (!existsSync(py)) {
    console.log('      (skipped: no OpenCascade python; set OCCT_PYTHON)');
    return;
  }
  const r = spawnSync(py, [join(ROOT, 'tests/validate_step_basic.py'), stepFile, '80'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  console.log('      ' + r.stdout.trim().split('\n').at(-1));
});

await test('share link round-trips the whole build in a fresh tab', async () => {
  await page.click('[data-testid="open-share"]');
  const url = await page.$eval('[data-testid="share-url"]', (e) => e.value);
  assert(url.includes('#build='), url.slice(0, 80));
  await page.keyboard.press('Escape');
  const p2 = await newPage({ fresh: false });
  await p2.goto(url.replace(/^https?:\/\/[^/]+\//, URL0), { waitUntil: 'load' });
  await sleep(800);
  const n = await p2.evaluate(() => window.__ignite.store.getState().instances.length);
  assert(n === 80, `shared build has ${n}`);
  await p2.close();
});

await test('light / dark themes', async () => {
  const dark0 = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.click('[data-testid="theme-toggle"]');
  await sleep(300);
  const dark1 = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  assert(dark0 !== dark1, 'theme toggled');
  await shot(dark1 ? '11-dark' : '11-light');
  await page.click('[data-testid="theme-toggle"]');
  await sleep(300);
  await shot(dark1 ? '11-light' : '11-dark');
});

await test('custom part: upload STL, auto-centre a hole, save, snap it onto a channel', async () => {
  // make an STL of a single 3-hole flat beam with the app's own exporter
  await st(() => {
    const s = window.__ignite.store.getState();
    s.setInstances([{ instanceId: 'beam', sku: '1102-0003-0048', position: [0, 0, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]);
  });
  for (const f of readdirSync(DL)) if (f.endsWith('.stl')) rmSync(join(DL, f));
  await page.click('[data-testid="open-export"]');
  await page.click('[data-testid="export-stl"]');
  const stlPath = await waitFile(/\.stl$/);
  const fresh = join(DL, 'beam-upload.stl');
  copyFileSync(stlPath, fresh);
  rmSync(stlPath);
  await page.keyboard.press('Escape');
  await page.click('[data-testid="open-upload"]');
  const input = await page.$('[data-testid="upload-file"]');
  await input.uploadFile(fresh);
  await sleep(1200);
  // STL is Z-up: the 3 mm plate spans z, holes at x = -16, 0, 16. Centered -> top face at z = +1.5.
  await page.evaluate(() => window.__igniteStudio.tag([16 + 3.1, 0.6, 1.5], [0, 0, 1]));
  await sleep(150);
  const holes = await page.evaluate(() => window.__igniteStudio.holes());
  assert(holes.length === 2, `through hole -> 2 faces, got ${holes.length}: ${JSON.stringify(holes)} bounds ${JSON.stringify(await page.evaluate(() => window.__igniteStudio.bounds()))}`);
  assert(holes[0].type === 'm4_hole', `classified ${holes[0].type}`);
  const err = Math.hypot(holes[0].position[0] - 16, holes[0].position[1] - 0);
  assert(err < 0.15, `auto-centred within ${err.toFixed(3)} mm`);
  assert(Math.abs(holes[0].depth - 3) < 0.05, `thickness ${holes[0].depth}`);
  await shot('12-upload-studio');
  await page.click('[data-testid="save-custom"]');
  await sleep(400);
  const part = await st(() => Object.values(window.__ignite.store.getState().catalog).find((p) => p.isCustom));
  assert(part && part.snapPoints.length === 2, 'custom part in catalog');
  assert(await st(() => !!window.__ignite.store.getState().placingSku), 'placing custom part');
  await page.keyboard.press('Escape');
});

await test('real .glb from the GitHub CDN replaces the procedural model (and is cached)', async () => {
  // build a fixture GLB (a 5-hole beam) and serve it as the 3-hole beam's CDN mesh
  fixtureGlb = Buffer.from(await st(() => window.__ignite.partGlb('1102-0005-0080')));
  const p3 = await newPage({ fresh: false });
  await p3.goto(URL0, { waitUntil: 'load' });
  await sleep(500);
  await p3.evaluate(() => {
    const s = window.__ignite.store.getState();
    s.set({ modal: null });
    s.setInstances([{ instanceId: 'b', sku: '1102-0003-0048', position: [0, 0, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]);
  });
  let status;
  for (let i = 0; i < 40 && status !== 'remote'; i++) {
    await sleep(150);
    status = await p3.evaluate(() => window.__ignite.store.getState().assetStatus['1102-0003-0048']);
  }
  assert(status === 'remote', `status ${status}`);
  const other = await p3.evaluate(() => window.__ignite.store.getState().assetStatus['1120-0001-0048']);
  assert(other !== 'remote', 'parts without a .glb stay procedural');
  await p3.close();
  fixtureGlb = null;
});

await test('no uncaught errors in the page', async () => {
  assert(pageErrors.length === 0, pageErrors.slice(0, 5).join('\n'));
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e tests passed`);
process.exit(failed.length ? 1 : 0);
void statSync;
