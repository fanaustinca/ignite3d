// node review/render.mjs SKU [SKU...]  -> review/img/{SKU}.png   (needs: python3 -m http.server 4960 in ~/ignite3d-assets)
import puppeteer from '/home/austin/ignite3d/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 1000 });
const extra = process.env.VIEW ? `&view=${process.env.VIEW}&zoom=${process.env.ZOOM || 1}` : '';
for (const sku of process.argv.slice(2)) {
  try {
    await p.goto(`http://localhost:4960/review/viewer.html?sku=${sku}${extra}&t=${Date.now()}`, { waitUntil: 'load' });
    await p.waitForFunction('window.done === true', { timeout: 30000 });
    await p.screenshot({ path: `/home/austin/ignite3d-assets/review/img/${sku}${process.env.VIEW ? '-' + process.env.VIEW : ''}.png` });
    console.log('ok', sku);
  } catch (e) { console.log('fail', sku, e.message); }
}
await b.close();
