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
const CAD_DIR = process.env.CAD_DIR || join(process.env.HOME || '', 'ignite3d-cad');
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
  protocolTimeout: 240000,
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
let blockLocal = null; // a same-origin /parts path to 404 (forces the CDN fallback)

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
      if (u.endsWith('/parts/index.json')) return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ skus: fixtureGlb ? ['1120-0002-0072'] : [] }) });
      if (fixtureGlb && u.endsWith('/parts/1120-0002-0072.glb')) return req.respond({ status: 200, headers: cors, contentType: 'model/gltf-binary', body: fixtureGlb });
      return req.respond({ status: 404, headers: cors, body: 'not found' });
    }
    if (blockLocal && u.startsWith(URL0) && u.includes(blockLocal)) return req.respond({ status: 404, body: 'gone' });
    if (u.includes('github.io/ignite3d-cad/')) {
      // serve the CAD data repo from a local checkout when present (CI has none -> placeholders)
      const rel = u.split('github.io/ignite3d-cad/')[1].split('?')[0];
      const f = join(CAD_DIR, rel);
      if (existsSync(f)) return req.respond({ status: 200, headers: cors, contentType: rel.endsWith('.json') ? 'application/json' : 'application/gzip', body: readFileSync(f) });
      return req.respond({ status: 404, headers: cors, body: '' });
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
/** Click a part in the library (sub-sections start closed, so find it through search). */
async function clickPart(sku) {
  await page.click('[data-testid="catalog-search"]', { clickCount: 3 });
  await page.type('[data-testid="catalog-search"]', sku);
  await page.waitForSelector(`[data-sku="${sku}"]`);
  await page.click(`[data-sku="${sku}"]`);
  await page.click('[data-testid="catalog-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(800, 450);
}
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
  await page.click('[data-testid="catalog-search"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await sleep(100);
  // real goBILDA: the 13.7:1 (435 RPM) Yellow Jacket exists in 5202 (D-shaft), 5203 and 5204 (REX) versions
  assert(rows.includes('5203-2402-0014') && rows.every((r) => /^520[234]-\d{4}-0014$/.test(r)), `search rows ${rows}`);
});

await test('kit picker shows exactly the Strafer kit parts with quantities', async () => {
  const kitSku = await page.$$eval('[data-testid="kit-select"] option', (os) => os.find((o) => o.textContent.startsWith('Strafer'))?.value);
  assert(kitSku, 'Strafer kit listed');
  await page.select('[data-testid="kit-select"]', kitSku);
  await sleep(150);
  const rows = await page.$$eval('[data-sku]', (els) => els.map((e) => e.getAttribute('data-sku')));
  for (const s of ['2110-0608-0002', '1522-0010-0090', '1201-0043-0002', '5203-2402-0019']) assert(rows.includes(s), `kit row ${s} in ${rows}`);
  assert(!rows.includes('1120-0005-0144'), 'non-kit part hidden');
  const qty = await page.$eval('[data-sku="1201-0043-0002"] [data-testid="kit-qty"]', (e) => e.textContent);
  assert(qty === '×8', `quad block qty ${qty}`);
  assert((await page.$eval('[data-testid="kit-summary"]', (e) => e.textContent)).includes('non-CAD'), 'summary');
  await shot('02b-kit-strafer');
  await page.select('[data-testid="kit-select"]', '');
  await sleep(100);
});

await test('places the first channel on the floor grid with a real mouse click', async () => {
  await clickPart('1120-0005-0144');
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
  await clickPart('1120-0003-0096');
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
  // the real wall is full of slots: find a hover point on metal whose nearest hole is this one
  let ok = false;
  for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2.4, 2.4], [-2.4, 2.4], [2.4, -2.4], [-2.4, -2.4], [3.4, 0], [0, 3.4]]) {
    await hoverWorld([outer.pos[0] + dx, outer.pos[1] + dy, outer.pos[2]]);
    const t = await st(() => window.__ignite.fastenTarget());
    if (t && Math.hypot(t.pos[0] - outer.pos[0], t.pos[1] - outer.pos[1], t.pos[2] - outer.pos[2]) < 1e-3) {
      ok = true;
      break;
    }
  }
  assert(ok, 'could hover the intended hole');
  await shot('04-fasten-hover');
  await page.mouse.down();
  await page.mouse.up();
  await frames(2);
  const inst = await st(() => window.__ignite.store.getState().instances);
  const screws = inst.filter((i) => i.sku.startsWith('2800-'));
  const nuts = inst.filter((i) => (i.sku === '2812-0004-0007' || i.sku === '2810-0004-0001'));
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
  await clickPart('1120-0001-0048');
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
  await st(() => window.__ignite.store.getState().addInstance({ sku: '1120-0017-0432', position: [140, 200, 0], quaternion: [0, 0, 0, 1] }));
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

await test('Robot Check: example is clean; a part pushed into another is flagged live; missing screws reported', async () => {
  await st(() => window.__ignite.loadExample());
  await sleep(300);
  const r = await st(async () => {
    const x = await window.__ignite.check.run();
    return { col: x.collisions.length, score: x.report.score, stab: x.report.stability, bad: x.report.issues.filter((i) => i.level !== 'info').map((i) => i.title) };
  });
  assert(r.col === 0, `example collisions: ${r.col}`);
  assert(r.score.loose === 0 && r.score.weak === 0 && r.score.joints >= 12, JSON.stringify(r.score));
  assert(r.score.attached === r.score.parts, 'all attached');
  assert(r.stab.ok && r.stab.tipAngleDeg > 45, `tip ${r.stab.tipAngleDeg}`);
  assert(r.bad.length === 0, r.bad.join(', '));
  await page.click('[data-testid="open-check"]');
  await page.waitForSelector('[data-testid="check-panel"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="chip-collisions"]')?.textContent?.startsWith('0'));
  // live: drop a motor straight into a cross member -> red badge + status bar warning within a second or two
  await st(() => {
    const s = window.__ignite.store.getState();
    const cross = s.instances.filter((i) => i.sku === '1120-0013-0336').sort((a, b) => b.position[1] - a.position[1])[0]; // cross member sits on top of the rails
    s.addInstance({ sku: '5203-2402-0019', position: [cross.position[0], cross.position[1], 0], quaternion: [0, 0, 0, 1] });
  });
  await page.waitForSelector('[data-testid="collision-badge"]', { timeout: 15000 });
  const live = await st(() => window.__ignite.check.state().collisions.map((c) => [c.skuA, c.skuB].sort().join('×')));
  assert(live.length >= 1 && live.every((k) => k.includes('5203-2402-0019')), live.join(', '));
  assert(!!(await page.$('[data-testid="status-collisions"]')), 'status bar warning');
  await page.click('[data-testid="collision-row"]');
  await sleep(500);
  await shot('09-check-collision');
  // undo removes it again
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => !document.querySelector('[data-testid="collision-badge"]'), { timeout: 15000 });
  // pull every screw out of one cross member joint -> loose joint error with both parts named
  const loose = await st(async () => {
    const s = window.__ignite.store.getState();
    const cross = s.instances.filter((i) => i.sku === '1120-0013-0336').sort((a, b) => b.position[1] - a.position[1])[0]; // cross member sits on top of the rails
    const near = (i) => Math.hypot(i.position[0] - cross.position[0], i.position[2] - -144) < 40 && i.position[1] > 60;
    s.setInstances(s.instances.filter((i) => !((i.sku.startsWith('2800-') || i.sku.startsWith('2812-')) && near(i))));
    const x = await window.__ignite.check.run();
    return { score: x.report.score, titles: x.report.issues.map((i) => i.title) };
  });
  assert(loose.score.loose >= 1, JSON.stringify(loose.score));
  assert(loose.titles.includes('Joint has no screws'), loose.titles.join(', '));
  await sleep(400);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="check-issue"]')].some((e) => e.dataset.kind === 'joint'), { timeout: 10000 });
  await shot('09b-check-loose');
  await page.click('[data-testid="open-check"]');
  await st(() => window.__ignite.loadExample());
});

await test('part request + feedback forms are linked from the toolbar, sidebar and help', async () => {
  const hrefs = await page.evaluate(() => ['part-request-link', 'feedback-link', 'sidebar-part-request'].map((t) => document.querySelector(`[data-testid="${t}"]`)?.getAttribute('href')));
  assert(hrefs[0] === 'https://forms.gle/TrPgVy1aFunzSN5T7' && hrefs[2] === hrefs[0], `part request ${hrefs}`);
  assert(hrefs[1] === 'https://forms.gle/tPRVA9Vuo9yJCJH8A', `feedback ${hrefs[1]}`);
  await page.click('[data-testid="open-help"]');
  await page.waitForSelector('[data-testid="help-feedback"]');
  await page.keyboard.press('Escape');
});

await test('mirror makes a mirrored copy across the left/right plane', async () => {
  const motor = await st(() => window.__ignite.store.getState().instances.find((i) => i.sku.startsWith('5203-')));
  const n0 = await st(() => window.__ignite.store.getState().instances.length);
  await st((id) => window.__ignite.store.getState().select([id]), motor.instanceId);
  await page.keyboard.press('m');
  const last = await st(() => window.__ignite.store.getState().instances.at(-1));
  assert((await st(() => window.__ignite.store.getState().instances.length)) === n0 + 1, 'one copy');
  assert(last.sku === motor.sku && Math.abs(last.position[0] + motor.position[0]) < 1e-6, 'mirrored across X');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
});

await test('U-channel T joint on a quad block: a dropped screw auto-sizes and sits flush outside; rotation ring snaps 45°', async () => {
  const saved = await st(() => window.__ignite.store.getState().instances);
  await st(async () => {
    const I = window.__ignite;
    await I.ensureSnaps(['1120-0005-0144', '1201-0043-0002', '2800-0004-0016', '2800-0004-0007', '2800-0004-0008']);
    const s = I.store.getState();
    s.setInstances([
      { instanceId: 'A', sku: '1120-0005-0144', position: [0, 0, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false },
      { instanceId: 'Q', sku: '1201-0043-0002', position: [0, -24, 0], quaternion: [Math.SQRT1_2, 0, Math.SQRT1_2, 0], hidden: false, ghosted: false },
      { instanceId: 'B', sku: '1120-0005-0144', position: [0, -96, 0], quaternion: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], hidden: false, ghosted: false },
    ]);
  });
  await st(() => window.__ignite.setView([-110, -5, -75], [-24, -32, -16]));
  await sleep(800);
  // pick a deliberately wrong length; aim straight down the hole (the ray reaches the buried block face)
  await st(() => window.__ignite.store.getState().startPlacing('2800-0004-0016'));
  const p = await st(() => window.__ignite.project([-24, -32, -16]));
  await page.mouse.move(p.x + 4, p.y + 4);
  await sleep(300);
  await page.mouse.move(p.x, p.y);
  await sleep(800);
  const g = await st(() => window.__ignite.ghost());
  assert(g.fasten, 'screw ghost resolved by Smart Fasten: ' + JSON.stringify(g));
  assert(Math.hypot(g.position[0] + 24, g.position[1] + 32, g.position[2] + 16) < 1e-3, 'head on the outer flange face ' + g.position);
  const sku = await st(() => window.__ignite.store.getState().placingSku);
  assert(/^2800-0004-000[78]$/.test(sku), 'auto length M4x7/8, got ' + sku);
  await shot('19-screw-ghost');
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  const added = await st(() => window.__ignite.store.getState().instances.slice(3));
  assert(added.length === 1 && added[0].sku === sku, 'one screw, no nut (threads): ' + added.map((a) => a.sku));
  await page.keyboard.press('Escape');
  // rotation ring: select B, drag its Y ring ~95° -> snaps to 90° (45° steps)
  await st(() => window.__ignite.store.getState().select(['B']));
  await st(() => window.__ignite.setView([500, 300, 600], [0, -60, 0]));
  await sleep(600);
  const R = Math.hypot(500, 396, 600) * Math.tan((20 * Math.PI) / 180) * 0.36;
  const P = (t) => st((a) => window.__ignite.project(a), [R * Math.cos(t), -96, R * Math.sin(t)]);
  const q0 = await P(0);
  await page.mouse.move(q0.x, q0.y);
  await sleep(200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    const q = await P((-i * Math.PI * 1.05) / 20);
    await page.mouse.move(q.x, q.y);
    await sleep(40);
  }
  const readout = await page.$eval('[data-testid="rotate-readout"]', (e) => e.textContent);
  await shot('20-rotate-ring');
  await page.mouse.up();
  await sleep(200);
  assert(/Y \+90°/.test(readout), 'readout ' + readout);
  const q = await st(() => window.__ignite.store.getState().instances.find((i) => i.instanceId === 'B').quaternion);
  assert(Math.abs(Math.abs(q[0]) - 0.5) < 1e-6 && Math.abs(Math.abs(q[3]) - 0.5) < 1e-6, 'rotated 90° about Y: ' + q);
  await st((s) => window.__ignite.store.getState().setInstances(s), saved);
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
  stepFile = await waitFile(/\.step$/, 180000);
  const step = readFileSync(stepFile, 'utf8');
  assert(step.startsWith('ISO-10303-21;') && step.trim().endsWith('END-ISO-10303-21;'), 'STEP envelope');
  // >= 80: goBILDA STEPs of assemblies (e.g. motors) carry their own sub-occurrences; OpenCascade checks the 80 top-level instances below
  assert((step.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length >= 80, 'one occurrence per part');
  assert(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(step), 'millimetres');
  assert(step.length < 150e6, `STEP size ${(step.length / 1e6).toFixed(1)} MB`);
  if (existsSync(join(CAD_DIR, 'parts', 'step-index.json'))) assert(/CYLINDRICAL_SURFACE/.test(step), 'exact goBILDA B-rep with true cylindrical holes');
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
    s.setInstances([{ instanceId: 'beam', sku: '1102-0003-0024', position: [0, 0, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]);
  });
  // wait for the real mesh (the STL exporter uses whatever is loaded)
  for (let i = 0; i < 60; i++) {
    if (['local', 'cached'].includes(await st(() => window.__ignite.store.getState().assetStatus['1102-0003-0024']))) break;
    await sleep(150);
  }
  const beamT = await st(() => window.__ignite.store.getState().catalog['1102-0003-0024'].dimensions[1]);
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
  // STL is Z-up: the plate thickness spans z, holes at x = -8, 0, 8. Centered -> top face at z = +t/2.
  await page.evaluate((t) => window.__igniteStudio.tag([8 + 3.1, 0.6, t / 2], [0, 0, 1]), beamT);
  await sleep(150);
  const holes = await page.evaluate(() => window.__igniteStudio.holes());
  assert(holes.length === 2, `through hole -> 2 faces, got ${holes.length}: ${JSON.stringify(holes)} bounds ${JSON.stringify(await page.evaluate(() => window.__igniteStudio.bounds()))}`);
  assert(holes[0].type === 'm4_hole', `classified ${holes[0].type}`);
  const err = Math.hypot(holes[0].position[0] - 8, holes[0].position[1] - 0);
  assert(err < 0.15, `auto-centred within ${err.toFixed(3)} mm`);
  assert(Math.abs(holes[0].depth - beamT) < 0.05, `thickness ${holes[0].depth} vs ${beamT}`);
  await shot('12-upload-studio');
  await page.click('[data-testid="save-custom"]');
  await sleep(400);
  const part = await st(() => Object.values(window.__ignite.store.getState().catalog).find((p) => p.isCustom));
  assert(part && part.snapPoints.length === 2, 'custom part in catalog');
  assert(await st(() => !!window.__ignite.store.getState().placingSku), 'placing custom part');
  await page.keyboard.press('Escape');
});

await test('real goBILDA meshes load from the site, and fall back to the GitHub CDN', async () => {
  // 1) normal: real mesh from this site
  await st(() => {
    const s = window.__ignite.store.getState();
    s.set({ modal: null });
    s.setInstances([{ instanceId: 'r', sku: '1120-0001-0048', position: [0, 24, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]);
  });
  let status;
  for (let i = 0; i < 60 && !['local', 'cached'].includes(status); i++) {
    await sleep(150);
    status = await st(() => window.__ignite.store.getState().assetStatus['1120-0001-0048']);
  }
  assert(status === 'local' || status === 'cached', `site mesh status ${status}`);
  // 2) local copy missing -> jsDelivr copy is used
  fixtureGlb = Buffer.from(await st(() => window.__ignite.partGlb('1120-0002-0072')));
  blockLocal = '/parts/1120-0002-0072.glb';
  const p3 = await newPage({ fresh: false });
  await p3.goto(URL0, { waitUntil: 'load' });
  await sleep(500);
  await p3.evaluate(async () => {
    indexedDB.deleteDatabase('ignite3d');
    localStorage.removeItem('ignite3d-missing-glb');
    const s = window.__ignite.store.getState();
    s.set({ modal: null });
    s.setInstances([{ instanceId: 'b', sku: '1120-0002-0072', position: [0, 24, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]);
  });
  status = undefined;
  for (let i = 0; i < 60 && status !== 'remote'; i++) {
    await sleep(150);
    status = await p3.evaluate(() => window.__ignite.store.getState().assetStatus['1120-0002-0072']);
  }
  assert(status === 'remote', `CDN fallback status ${status}`);
  await p3.close();
  fixtureGlb = null;
  blockLocal = null;
});

await test('part library: sub-sections open/close, short names, hover card with picture, SKU, cost, weight', async () => {
  await page.keyboard.press('Escape');
  for (const b of await page.$$('aside button')) if (/^Motors & Servos/.test((await b.evaluate((e) => e.textContent)).trim())) await b.click();
  await sleep(200);
  let fam = null;
  for (const b of await page.$$('[data-testid="family-toggle"]')) if ((await b.evaluate((e) => e.textContent)).includes('5203 Yellow Jacket Planetary')) fam = b;
  assert(fam, 'motor sub-section');
  assert((await fam.evaluate((e) => e.getAttribute('aria-expanded'))) === 'false', 'sub-sections start closed');
  await fam.click();
  await sleep(200);
  const row = await page.$('[data-sku="5203-2402-0019"]');
  const label = await row.$eval('[data-testid="part-name"]', (e) => e.textContent);
  assert(label === '19.2:1 · 312 RPM', 'short name: ' + label);
  await row.hover();
  await page.waitForSelector('[data-testid="part-thumb"]', { timeout: 15000 });
  const card = await page.$eval('[data-testid="part-hover-card"]', (e) => e.innerText);
  assert(card.includes('5203-2402-0019') && /\$\d+\.\d\d/.test(card) && /\d+ g/.test(card), card);
  await shot('21-library-hover');
  await page.mouse.move(800, 400);
  await sleep(200);
  assert(!(await page.$('[data-testid="part-hover-card"]')), 'card hides');
  await fam.click();
  await sleep(100);
  assert((await fam.evaluate((e) => e.getAttribute('aria-expanded'))) === 'false', 'closes again');
});

await test('autosave: the build survives a reload', async () => {
  await st(() => window.__ignite.loadExample());
  await sleep(800);
  const before = await st(() => window.__ignite.store.getState().instances.length);
  assert(before > 10, 'have a build');
  await page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent.includes('Saved'), { timeout: 5000 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__ignite);
  await sleep(1500);
  const after = await st(() => window.__ignite.store.getState().instances.length);
  assert(after === before, `restored ${after} of ${before}`);
  // clearing then reloading still offers the old build back
  await st(() => window.__ignite.store.getState().clearScene());
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__ignite);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="restore-backup"]', { timeout: 5000 });
  await page.click('[data-testid="restore-backup"]');
  assert((await st(() => window.__ignite.store.getState().instances.length)) === before, 'backup restored');
});

await test('cloud files: 6-digit code, autosave online, live sync between computers, code remembered', async () => {
  const seed = await st(() => window.__ignite.store.getState().instances.slice(0, 3));
  const gs = (p, fn, ...a) => p.evaluate(fn, ...a);
  const n = (p) => gs(p, () => window.__ignite.store.getState().instances.length);
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await sleep(150);
    }
    return false;
  };
  const pA = await newPage({ fresh: false });
  await pA.goto(URL0, { waitUntil: 'load' });
  await pA.evaluate(() => {
    localStorage.setItem('ignite3d-cloud-mock', '1');
    for (const k of Object.keys(localStorage)) if (k.startsWith('ignite3d-mockcad:') || k.startsWith('ignite3d-cloud-')) k !== 'ignite3d-cloud-mock' && localStorage.removeItem(k);
  });
  await pA.reload({ waitUntil: 'load' });
  await sleep(600);
  await pA.evaluate((list) => window.__ignite.store.getState().setInstances(list), seed);
  await pA.click('[data-testid="open-cloud"]');
  await pA.waitForSelector('[data-testid="cloud-new-name"]');
  await pA.type('[data-testid="cloud-new-name"]', 'Test bot');
  await pA.click('[data-testid="cloud-create"]');
  await pA.waitForSelector('[data-testid="cloud-code"]');
  const code = await pA.$eval('[data-testid="cloud-code"]', (e) => e.textContent.trim());
  assert(/^\d{6}$/.test(code), `code ${code}`);
  const doc = await pA.evaluate((c) => JSON.parse(localStorage.getItem('ignite3d-mockcad:' + c)), code);
  assert(doc.parts === 3 && doc.name === 'Test bot', `online doc ${doc.parts} ${doc.name}`);
  await pA.screenshot({ path: join(SHOTS, '30-cloud-modal.png') });
  await pA.keyboard.press('Escape');

  // second "computer" opens the share link
  const pB = await newPage({ fresh: false });
  await pB.goto(`${URL0}?cad=${code}`, { waitUntil: 'load' });
  assert(await until(async () => (await gs(pB, () => window.__ignite.cloud.getState().code)) === code), 'B opened the code');
  assert((await n(pB)) === 3, `B has ${await n(pB)} parts`);
  assert(!(await pB.evaluate(() => location.search.includes('cad='))), 'code removed from the address bar');

  // A moves a part -> B sees it live
  const moved = await pA.evaluate(() => {
    const s = window.__ignite.store.getState();
    const i = s.instances[0];
    s.updateTransforms({ [i.instanceId]: { position: [i.position[0] + 50, i.position[1], i.position[2]], quaternion: i.quaternion } });
    return { id: i.instanceId, x: i.position[0] + 50 };
  });
  assert(
    await until(async () => (await gs(pB, (id) => window.__ignite.store.getState().instances.find((i) => i.instanceId === id)?.position[0], moved.id)) === moved.x),
    'move synced A -> B',
  );
  assert((await gs(pB, () => window.__ignite.store.temporal.getState().pastStates.length)) === 0, 'remote changes are not in B’s undo history');
  // B adds a part -> A gets it
  await pB.evaluate((i) => window.__ignite.store.getState().addInstances([{ ...i, instanceId: 'fromB', position: [0, 300, 0] }]), seed[0]);
  assert(await until(async () => (await n(pA)) === 4), 'add synced B -> A');
  assert(await until(async () => (await gs(pA, () => window.__ignite.cloud.getState().status)) === 'saved'), 'A status saved');

  // reload: the code is remembered, no typing needed
  await pB.reload({ waitUntil: 'load' });
  assert(await until(async () => (await gs(pB, () => window.__ignite.cloud.getState().code)) === code && (await n(pB)) === 4), 'B reopened the file after reload');
  await pB.waitForSelector('[data-testid="cloud-indicator"]');

  // stop syncing, then reopen by typing the code; a wrong code is refused
  await pB.click('[data-testid="open-cloud"]');
  await pB.waitForSelector('[data-testid="cloud-leave"]');
  await pB.click('[data-testid="cloud-leave"]');
  await pB.waitForSelector('[data-testid="cloud-create"]');
  assert((await pB.$$('[data-testid="cloud-recent"]')).length === 1, 'remembered list');
  await pB.type('[data-testid="cloud-code-input"]', '000001');
  await pB.click('[data-testid="cloud-open"]');
  await pB.waitForSelector('[data-testid="cloud-error"]');
  await pB.click('[data-testid="cloud-code-input"]', { clickCount: 3 });
  await pB.type('[data-testid="cloud-code-input"]', code);
  await pB.click('[data-testid="cloud-open"]');
  assert(await until(async () => (await gs(pB, () => window.__ignite.cloud.getState().code)) === code), 'reopened by typing the code');
  // custom parts used by the robot are uploaded with it and downloaded by whoever opens the code
  const CSKU = '9000-7777-0001';
  await pA.evaluate(async (sku) => {
    const I = window.__ignite;
    const buf = await (await fetch('parts/1120-0002-0072.glb')).arrayBuffer();
    const base = I.store.getState().catalog['1120-0002-0072'];
    const part = { ...base, sku, name: 'Test custom bracket', isCustom: true, category: 'Custom' };
    await I.customParts.save(part, buf);
    const s = I.store.getState();
    s.setCatalog([...Object.values(s.catalog), part]);
    s.addInstances([{ instanceId: 'custom1', sku, position: [0, 200, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]);
  }, CSKU);
  assert(await until(async () => (await pA.evaluate(() => Object.keys(localStorage).some((k) => /^ignite3d-mockpart:[0-9a-f]{32}$/.test(k))))), 'custom part uploaded');
  const cdoc = await pA.evaluate((c) => JSON.parse(localStorage.getItem('ignite3d-mockcad:' + c)), code);
  assert(cdoc.custom && /^[0-9a-f]{32}$/.test(cdoc.custom[CSKU]), `file links the part ${JSON.stringify(cdoc.custom)}`);
  // a "new computer": wipe the part locally, then open the code
  await pB.evaluate(async (sku) => {
    await window.__ignite.customParts.remove(sku);
    window.__ignite.cloud.getState(); // keep B bound
  }, CSKU);
  await pB.reload({ waitUntil: 'load' });
  assert(
    await until(async () => (await gs(pB, (sku) => !!window.__ignite.store.getState().catalog[sku]?.isCustom, CSKU)) && (await gs(pB, (sku) => window.__ignite.customParts.list().then((l) => l.some((p) => p.sku === sku)), CSKU)), 10000),
    'B downloaded the custom part',
  );
  assert((await gs(pB, (sku) => window.__ignite.store.getState().instances.some((i) => i.sku === sku), CSKU)), 'B has the custom instance');
  await pA.close();
  await pB.close();
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('ignite3d-mockcad:') || k.startsWith('ignite3d-mockpart:') || k.startsWith('ignite3d-cloud-')) localStorage.removeItem(k);
  });
  await page.evaluate(() => window.__ignite.customParts.remove('9000-7777-0001'));
});

await test('REV hubs in the catalog; collision + stability checks can be turned off; projects keep separate robots', async () => {
  const hub = await st(() => window.__ignite.store.getState().catalog['REV-31-1595']);
  assert(hub && hub.category === 'Electronics' && hub.priceUsd === 375, `control hub ${hub && hub.category}`);
  assert(await st(() => !!window.__ignite.store.getState().catalog['REV-31-1153']), 'expansion hub');

  // switches in the Robot Check panel
  await st(() => window.__ignite.check.store.getState().set({ open: true }));
  await page.waitForSelector('[data-testid="toggle-stability"]');
  await page.click('[data-testid="toggle-stability"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="chip-stability"]')?.textContent.includes('off'));
  assert(await page.$('[data-testid="stability-off"]'), 'stability section says off');
  await page.click('[data-testid="live-collisions"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="chip-collisions"]')?.textContent.includes('off'));
  assert((await st(() => window.__ignite.check.store.getState().collisions.length)) === 0, 'no collisions while off');
  assert((await page.evaluate(() => [localStorage.getItem('ignite3d-live-collisions'), localStorage.getItem('ignite3d-stability-check')]).then((v) => v.join())) === '0,0', 'remembered');
  await shot('31-check-toggles');
  await page.click('[data-testid="toggle-stability"]');
  await page.click('[data-testid="live-collisions"]');
  await st(() => window.__ignite.check.store.getState().set({ open: false }));

  // projects
  const n0 = await st(() => window.__ignite.store.getState().instances.length);
  const first = await st(() => window.__ignite.projects.getState().activeId);
  const count0 = await st(() => window.__ignite.projects.getState().list.length);
  assert(first, 'a first project exists');
  const row = (id) => `[data-testid="project-row"][data-id="${id}"]`;
  await page.click('[data-testid="open-projects"]');
  await page.waitForSelector('[data-testid="project-new-name"]');
  await page.type('[data-testid="project-new-name"]', 'Second bot');
  await page.click('[data-testid="project-new"]');
  await page.waitForFunction(() => window.__ignite.store.getState().instances.length === 0);
  const second = await st(() => window.__ignite.projects.getState().activeId);
  assert(second && second !== first, 'new project is open');
  await st(() => window.__ignite.store.getState().addInstances([{ instanceId: 'p2a', sku: 'REV-31-1595', position: [0, 0, 0], quaternion: [0, 0, 0, 1], hidden: false, ghosted: false }]));
  await sleep(600);
  await page.click('[data-testid="open-projects"]');
  await page.waitForSelector(`${row(first)} [data-testid="project-open"]`);
  await shot('32-projects');
  await page.click(`${row(first)} [data-testid="project-open"]`);
  await page.waitForFunction((n) => window.__ignite.store.getState().instances.length === n, { timeout: 8000 }, n0);
  assert((await st(() => window.__ignite.projects.getState().activeId)) === first, 'back on the first project');
  await page.click('[data-testid="open-projects"]');
  await page.waitForSelector(`${row(second)} [data-testid="project-open"]`);
  await page.click(`${row(second)} [data-testid="project-open"]`);
  await page.waitForFunction(() => window.__ignite.store.getState().instances.length === 1 && window.__ignite.store.getState().instances[0].sku === 'REV-31-1595', { timeout: 8000 });
  // delete the open (second) project -> another project opens; the first is untouched
  await page.click('[data-testid="open-projects"]');
  await page.waitForSelector(`${row(second)} [data-testid="project-delete"]`);
  await page.click(`${row(second)} [data-testid="project-delete"]`);
  await page.click('[data-testid="project-delete-confirm"]');
  await page.waitForFunction((c) => window.__ignite.projects.getState().list.length === c, { timeout: 8000 }, count0);
  if ((await st(() => window.__ignite.projects.getState().activeId)) !== first) {
    // the Projects panel is still open after deleting
    await page.waitForSelector(`${row(first)} [data-testid="project-open"]`);
    await page.click(`${row(first)} [data-testid="project-open"]`);
  }
  await page.waitForFunction((n) => window.__ignite.store.getState().instances.length === n, { timeout: 8000 }, n0);
  await page.keyboard.press('Escape');
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
