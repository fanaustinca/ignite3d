// Generates public/catalog.json (served from GitHub via jsDelivr) from the built-in catalog.
// Remote entries only override the built-in ones when `version` is bumped above BUILTIN_CATALOG_VERSION.
import { readdirSync, writeFileSync } from 'node:fs';
import { BUILTIN_CATALOG, BUILTIN_CATALOG_VERSION } from '../src/data/catalog';

const parts = BUILTIN_CATALOG.map(({ procedural: _p, ...rest }) => rest);
const out = { version: BUILTIN_CATALOG_VERSION, generated: new Date().toISOString().slice(0, 10), parts };
writeFileSync('public/catalog.json', JSON.stringify(out));
console.log(`catalog.json: ${parts.length} parts, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);

// parts/index.json: which real meshes exist (the app only requests listed .glb files)
const skus = readdirSync('public/parts').filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.glb$/, '')).sort();
writeFileSync('public/parts/index.json', JSON.stringify({ skus }, null, 1) + '\n');
console.log(`parts/index.json: ${skus.length} meshes`);
