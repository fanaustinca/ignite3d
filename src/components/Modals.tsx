import { FEEDBACK_FORM, PART_REQUEST_FORM } from '../config/links';
import { useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, FileJson, FolderOpen, Github, RefreshCw, Trash2 } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { bomCsv, bomRows, buildGlb, buildManifest, buildStep, buildStl, download } from '../export/files';
import { fromBuildFile, shareUrl, toBuildFile } from '../lib/share';
import { Btn, Modal } from './ui';
import { LogoMark, Wordmark } from './Logo';
import { APP_VERSION, TEAM_CREDIT } from '../version';
import { SNAP_COLORS } from '../lib/snap';
import { DEFAULT_REPO, cdnBase, parseRepo, repoLabel, saveAssetConfig, type AssetConfig } from '../config/assets';
import { cacheClear } from '../services/cache';
import { clearGlbIndex, clearMissingCache, fetchStepFragments, loadFullCatalog } from '../services/assetLoader';
import { listCustomParts } from '../services/customParts';
import { resetUpgradeAttempts } from '../services/visuals';
import { loadExample } from '../lib/loadExample';
import { viewportBus } from '../viewport/Viewport';
import { loadOnshapeSettings, onshapeToken, pushToOnshape, saveOnshapeSettings, startOnshapeLogin } from '../services/onshape';

const SHORTCUTS: [string, string][] = [
  ['Click part in catalog', 'Start placing it (stays active for repeat placement)'],
  ['Click', 'Place part / select part'],
  ['Shift+Click', 'Add to / remove from selection'],
  ['R / Shift+R', 'Rotate ghost (or selection) 90° / 45° about the hole axis'],
  ['Tab', 'Snap using the next compatible hole on the ghost part'],
  ['[  ]', 'Slide selected part along its mated axis 1 mm (Shift: 8 mm)'],
  ['S', 'Toggle hole snapping (OFF = free placement + gizmo grid)'],
  ['W / E', 'Gizmo: move arrows + rotation rings (drag a ring, snaps to the rotate increment, 45° default) / rotate-only'],
  ['F', 'Smart Fasten tool (click a hole in a joint)'],
  ['J', 'Fasten Joint: auto-screw all aligned joints of the selection'],
  ['M / Shift+M', 'Mirror selection left/right / front/back (mirrored copy)'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup sub-assembly'],
  ['H / Alt+H', 'Hide selection / unhide all'],
  ['G', 'Ghost (x-ray) selection'],
  ['B', '18″ sizing cube'],
  ['C', 'Center of gravity marker'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Delete selection'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+A', 'Select all'],
  ['Ctrl+S', 'Save build (.json)'],
  ['.', 'Zoom to fit'],
  ['Esc', 'Stop placing / leave tool / clear selection'],
  ['K', 'Robot Check (collisions, joints, stability)'],
  ['L', 'Live Test (beta): drive the robot, run intakes / arms'],
  ['?', 'This help'],
];

export function HelpModal() {
  const st = useCadStore();
  const [tab, setTab] = useState<'start' | 'keys' | 'onshape' | 'about'>('start');
  const tabs: [typeof tab, string][] = [
    ['start', 'Quick start'],
    ['keys', 'Shortcuts'],
    ['onshape', 'Onshape export'],
    ['about', 'About'],
  ];
  return (
    <Modal
      testid="help-modal"
      title={
        <span className="flex items-center gap-2">
          <LogoMark size={22} /> <Wordmark /> <span className="text-muted font-normal">help</span>
        </span>
      }
      onClose={() => st.set({ modal: null })}
    >
      <div className="mb-4 flex gap-1 border-b border-line">
        {tabs.map(([k, l]) => (
          <button
            type="button"
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${tab === k ? 'border-accent text-accent font-medium' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'start' && (
        <div className="space-y-3">
          <p>
            Ignite3D is a fast browser CAD for <b>goBILDA</b> FTC robots. Parts snap hole-to-hole on the goBILDA 8 mm grid, so everything you build lines up for real.
          </p>
          <ol className="space-y-2.5">
            {[
              ['Pick a part', 'Click any part in the left catalog. A see-through orange “ghost” follows your mouse. The first part lands on the floor grid.'],
              ['Snap it', 'Move over a part you already placed. Coloured rings show the holes it can mate with; the pulsing ring is the one it will snap to. Click to place. R rotates 90°, Tab tries another hole on the new part.'],
              ['Fasten it', 'Press J (Fasten Joint) to add screws + nylon locknuts to every aligned joint — screw lengths are picked from the plate thickness. Or press F and click individual holes, or drop a screw from the catalogue onto a hole: its length is fixed up to fit, the head always goes on the outside, a locknut is added when needed, and screws stop short where holes cross (quad block corners).'],
              ['Check it', 'K opens Robot Check: parts that pass through each other turn red (checked live as you build), joints without enough screws, screws without nuts, shafts without bearings, loose parts, and how far the robot can tilt before it tips. B shows the 18″ cube, C the center of gravity; BOM lists every SKU.'],
              ['Test it (beta)', 'L opens Live Test: it finds your motors, what they turn (directly, through gears or chain) and the wheels on the floor, then lets you drive (WASD / gamepad) and run intakes and arms against POLLEN and NECTAR on a few field tiles.'],
              ['Save it online', 'The cloud button gives your robot a 6-digit code. Every change saves online and shows up live for teammates who open the same code. Type a code once and this browser remembers it.'],
              ['Export it', 'Export → STEP Assembly, then in Onshape: Create → Assembly… or Import (cloud icon) the .step file. Every part keeps its SKU name and exact position.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">{i + 1}</span>
                <div>
                  <div className="font-semibold">{t}</div>
                  <div className="text-muted">{d}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-lg bg-panel-2 p-3">
            <div className="mb-1.5 text-[12px] font-semibold">Snap ring colours</div>
            <div className="flex flex-wrap gap-3 text-[12px]">
              {Object.entries(SNAP_COLORS).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: c }} />
                  {k}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-line p-3 text-[12.5px]">
            <span className="text-muted">Missing a part, or found a bug?</span>
            <a className="font-medium text-accent hover:underline" href={PART_REQUEST_FORM} target="_blank" rel="noopener noreferrer" data-testid="help-part-request">
              Request a part →
            </a>
            <a className="font-medium text-accent hover:underline" href={FEEDBACK_FORM} target="_blank" rel="noopener noreferrer" data-testid="help-feedback">
              Send feedback →
            </a>
          </div>
          <div className="flex gap-2">
            <Btn
              tone="accent"
              data-testid="help-example"
              onClick={() => {
                void loadExample();
                st.set({ modal: null });
                setTimeout(() => viewportBus.fit(), 50);
              }}
            >
              Load example drivetrain
            </Btn>
            <Btn onClick={() => st.set({ modal: null })}>Start building</Btn>
          </div>
        </div>
      )}
      {tab === 'keys' && (
        <table className="w-full text-[12.5px]">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k} className="border-b border-line/60">
                <td className="py-1.5 pr-4 align-top whitespace-nowrap">
                  {k.split(' / ').map((x, i) => (
                    <span key={x}>
                      {i > 0 && <span className="mx-1 text-muted">/</span>}
                      <kbd>{x}</kbd>
                    </span>
                  ))}
                </td>
                <td className="py-1.5 text-muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'onshape' && (
        <div className="space-y-3">
          <p>
            <b>STEP Assembly</b> is the recommended Onshape path. Each placed part becomes an assembly instance at its exact position (millimetres, Z-up), using <b>goBILDA&apos;s own exact
            geometry</b> for the part, so holes are true cylinders and Onshape mate connectors snap to hole centres.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Click <b>Export → STEP Assembly</b>.
            </li>
            <li>
              In Onshape open a document, click <b>+ → Import…</b> and pick the .step file.
            </li>
            <li>Onshape creates an Assembly tab with every instance, plus one Part Studio per SKU.</li>
          </ol>
          <p className="text-muted">
            The JSON manifest also contains every occurrence’s 4×4 transform in Onshape’s <code>/occurrencetransforms</code> format (row-major, metres, Z-up) for scripted workflows. STL and GLB are
            for slicers, renders and web viewers.
          </p>
        </div>
      )}
      {tab === 'about' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <LogoMark size={48} />
            <div>
              <div className="text-[18px]">
                <Wordmark />
              </div>
              <div className="text-muted">
                Version <span data-testid="about-version">{APP_VERSION}</span> · <span className="text-accent font-medium">{TEAM_CREDIT}</span>
              <div className="text-[12px]">Part geometry: goBILDA STEP files (gobilda.com)</div>
              </div>
            </div>
          </div>
          <p className="text-muted">
            100% in your browser: no account, no server. Your build autosaves locally. Parts load on demand from a GitHub repository through the jsDelivr CDN and are cached in your browser. goBILDA is
            a trademark of its owner; this is an unofficial community tool, so double-check critical dimensions against goBILDA drawings.
          </p>
        </div>
      )}
    </Modal>
  );
}

export function ShareModal() {
  const st = useCadStore();
  const url = useMemo(() => shareUrl(st.instances), [st.instances]);
  const [copied, setCopied] = useState(false);
  const custom = st.instances.some((i) => st.catalog[i.sku]?.isCustom);
  return (
    <Modal testid="share-modal" title="Share build" onClose={() => st.set({ modal: null })}>
      <p className="mb-2 text-muted">The whole build is compressed into this link — no server involved. Anyone who opens it gets a copy they can edit.</p>
      <div className="flex gap-2">
        <input data-testid="share-url" readOnly className="field flex-1 font-mono text-[11.5px]" value={url} onFocus={(e) => e.target.select()} />
        <Btn
          tone="accent"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
            } catch {
              /* clipboard blocked */
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </Btn>
      </div>
      <div className="mt-2 text-[11.5px] text-muted num">
        {st.instances.length} parts · {url.length.toLocaleString()} characters
      </div>
      {custom && <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[12px] text-amber-600">This build uses custom parts. Export them (Upload Custom Part → Export bundle) so others can load them.</div>}
    </Modal>
  );
}

export function BomModal() {
  const st = useCadStore();
  const rows = useMemo(() => bomRows(st.instances, st.catalog), [st.instances, st.catalog]);
  const tot = rows.reduce((a, r) => ({ q: a.q + r.qty, m: a.m + r.totalMassG, p: a.p + r.totalPriceUsd }), { q: 0, m: 0, p: 0 });
  return (
    <Modal testid="bom-modal" wide title="Bill of materials" onClose={() => st.set({ modal: null })}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-muted num">
          {rows.length} SKUs · {tot.q} parts · {(tot.m / 1000).toFixed(2)} kg ({(tot.m / 453.592).toFixed(2)} lb) · ${tot.p.toFixed(2)}
        </div>
        <Btn data-testid="bom-csv" tone="accent" disabled={!rows.length} onClick={() => download('ignite3d-bom.csv', bomCsv(rows), 'text/csv')}>
          <Download size={14} /> Download CSV
        </Btn>
      </div>
      {rows.length ? (
        <table className="w-full text-[12.5px]" data-testid="bom-table">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr className="border-b border-line">
              <th className="py-1.5">SKU</th>
              <th>Part</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Mass</th>
              <th className="text-right">Unit $</th>
              <th className="text-right">Total $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-b border-line/50">
                <td className="py-1.5 font-mono text-[11.5px]">{r.sku}</td>
                <td>
                  {r.name}
                  <span className="ml-2 text-[10.5px] text-muted">{r.category}</span>
                </td>
                <td className="text-right num font-semibold">{r.qty}</td>
                <td className="text-right num">{r.totalMassG.toFixed(1)} g</td>
                <td className="text-right num">{r.unitPriceUsd.toFixed(2)}</td>
                <td className="text-right num">{r.totalPriceUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="py-8 text-center text-muted">Nothing placed yet.</div>
      )}
      <p className="mt-3 text-[11.5px] text-muted">Prices and masses are estimates for planning; check goBILDA for current values.</p>
    </Modal>
  );
}

export function ExportModal() {
  const st = useCadStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('Ignite3D Robot');
  const [os, setOs] = useState(loadOnshapeSettings());
  const has = st.instances.some((i) => !i.hidden);
  const file = name.trim().replace(/[^\w.-]+/g, '_') || 'robot';
  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await fn();
      st.toast(`${label} exported`, 'ok');
    } catch (e) {
      st.toast(`${label} failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  // render helper (not a component) so buttons keep their DOM identity across renders
  const item = ({ id, title, desc, onClick, primary }: { id: string; title: string; desc: string; onClick: () => void; primary?: boolean }) => (
    <button
      key={id}
      type="button"
      data-testid={id}
      disabled={!has || !!busy}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-40 ${primary ? 'border-accent/60 bg-accent-soft hover:bg-accent/20' : 'border-line hover:bg-panel-2'}`}
    >
      <Download size={18} className={primary ? 'mt-0.5 text-accent' : 'mt-0.5 text-muted'} />
      <div>
        <div className="font-semibold">
          {title} {busy === title && <span className="ml-1 text-muted">…working</span>}
        </div>
        <div className="text-[12px] text-muted">{desc}</div>
      </div>
    </button>
  );
  return (
    <Modal testid="export-modal" title="Export" onClose={() => st.set({ modal: null })}>
      <label className="mb-3 flex items-center gap-2 text-[12.5px]">
        <span className="text-muted">Name</span>
        <input className="field flex-1" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="space-y-2">
        {item({
          id: 'export-step',
          primary: true,
          title: 'STEP Assembly (Onshape)',
          desc: 'Onshape → + → Import. One instance per part, named by SKU, exact positions, true round holes for mate connectors. Also opens in SolidWorks, Fusion, Inventor.',
          onClick: () =>
            run('STEP Assembly (Onshape)', async () => {
              const skus = [...new Set(st.instances.filter((i) => !i.hidden).map((i) => i.sku))];
              st.toast(`Fetching exact goBILDA geometry for ${skus.length} part types…`, 'info');
              const frags = await fetchStepFragments(skus, st.assetConfig);
              const n = Object.keys(frags).length;
              download(`${file}.step`, buildStep(st.instances, st.catalog, name, frags), 'application/step');
              if (n < skus.length)
                st.toast(`${n}/${skus.length} part types used exact goBILDA geometry; ${skus.length - n} were exported as placeholders (CAD data unreachable or not available for that part).`, 'warn');
            }),
        })}
        {item({ id: 'export-stl', title: 'STL mesh', desc: 'Single mesh in millimetres, Z-up. Good for renders, slicers and quick Onshape mesh import.', onClick: () => run('STL mesh', () => download(`${file}.stl`, buildStl(st.instances, st.catalog), 'model/stl')) })}
        {item({ id: 'export-glb', title: 'GLB (glTF)', desc: 'One node per part with SKU names; metres, Y-up (glTF standard). For web viewers and Blender.', onClick: () => run('GLB (glTF)', async () => download(`${file}.glb`, await buildGlb(st.instances, st.catalog), 'model/gltf-binary')) })}
        {item({
          id: 'export-json',
          title: 'JSON manifest',
          desc: "Build + BOM + every occurrence's Onshape /occurrencetransforms matrix (row-major, metres, Z-up). Re-open it here with “Open build”.",
          onClick: () => run('JSON manifest', () => download(`${file}.ignite3d.json`, JSON.stringify(buildManifest(st.instances, st.catalog), null, 1), 'application/json')),
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <Btn onClick={() => download(`${file}.ignite3d.json`, JSON.stringify(toBuildFile(st.instances), null, 1), 'application/json')} disabled={!has}>
          <FileJson size={14} /> Save build
        </Btn>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium hover:bg-panel-2">
          <FolderOpen size={14} /> Open build
          <input
            data-testid="open-build"
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const list = fromBuildFile(JSON.parse(await f.text()));
                if (!list) throw new Error('not an Ignite3D build');
                const unknown = list.filter((i) => !st.catalog[i.sku]).length;
                st.setInstances(list.filter((i) => st.catalog[i.sku]));
                st.toast(`Opened ${list.length} parts${unknown ? ` (${unknown} unknown SKUs skipped)` : ''}`, unknown ? 'warn' : 'ok');
                st.set({ modal: null });
                setTimeout(() => viewportBus.fit(), 50);
              } catch (err) {
                st.toast(`Could not open: ${(err as Error).message}`, 'error');
              }
            }}
          />
        </label>
      </div>
      <details className="mt-4 rounded-lg border border-line p-3">
        <summary className="cursor-pointer font-semibold">Advanced: push directly through the Onshape API</summary>
        <p className="mt-2 text-[12px] text-muted">
          Onshape’s API does not allow direct browser calls (no CORS), so this needs <b>your own Onshape OAuth app</b> (redirect URI = this page) and a small CORS relay you control. It inserts the
          parts you map below from the FTC Parts Library into an assembly and sets each <code>/occurrencetransforms</code>. Most teams should use the STEP export above.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
          {(
            [
              ['OAuth client ID', 'clientId'],
              ['CORS relay URL', 'proxyUrl'],
            ] as const
          ).map(([l, k]) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-muted">{l}</span>
              <input className="field" value={os[k]} onChange={(e) => setOs({ ...os, [k]: e.target.value })} />
            </label>
          ))}
          {(['did', 'wid', 'eid'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-muted">Target assembly {k}</span>
              <input className="field font-mono" value={os.target[k]} onChange={(e) => setOs({ ...os, target: { ...os.target, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
        <label className="mt-2 flex flex-col gap-0.5 text-[12px]">
          <span className="text-muted">SKU → library mapping (JSON: {'{"1120-0001-0048": {"documentId": "...", "elementId": "...", "versionId": "..."}}'})</span>
          <textarea
            className="field h-20 font-mono text-[11px]"
            defaultValue={JSON.stringify(os.library)}
            onBlur={(e) => {
              try {
                setOs({ ...os, library: JSON.parse(e.target.value || '{}') });
              } catch {
                st.toast('Mapping is not valid JSON', 'error');
              }
            }}
          />
        </label>
        <div className="mt-2 flex gap-2">
          <Btn onClick={() => saveOnshapeSettings(os)}>Save settings</Btn>
          <Btn disabled={!os.clientId || !os.proxyUrl} onClick={() => (saveOnshapeSettings(os), startOnshapeLogin(os))}>
            Sign in to Onshape
          </Btn>
          <Btn
            tone="accent"
            disabled={!onshapeToken() || !os.target.did}
            onClick={() =>
              run('Onshape push', async () => {
                const r = await pushToOnshape(os, onshapeToken()!, st.instances, st.catalog);
                if (r.missing.length) st.toast(`Pushed ${r.pushed}; ${r.missing.length} SKUs unmapped`, 'warn');
              })
            }
          >
            Push to Onshape
          </Btn>
        </div>
      </details>
    </Modal>
  );
}

export function SettingsModal() {
  const st = useCadStore();
  const [cfg, setCfg] = useState<AssetConfig>(st.assetConfig);
  const [repoTxt, setRepoTxt] = useState(repoLabel(cfg.primary));
  const [teamTxt, setTeamTxt] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async (c: AssetConfig) => {
    setBusy(true);
    saveAssetConfig(c);
    st.setAssetConfig(c);
    clearMissingCache();
    clearGlbIndex();
    resetUpgradeAttempts();
    const custom = await listCustomParts();
    const res = await loadFullCatalog(c, custom);
    st.setCatalog(res.parts);
    st.set({ assetStatus: {} });
    st.bumpVisuals();
    setBusy(false);
    st.toast(`Catalog reloaded: ${res.parts.length} parts${res.teamLoaded ? `, ${res.teamLoaded} team repo(s)` : ''}${c.useCdn && !res.remoteOk ? ' (CDN unreachable — using built-in catalog)' : ''}`, 'ok');
  };
  return (
    <Modal testid="settings-modal" title="Settings · GitHub parts repository" onClose={() => st.set({ modal: null })}>
      <div className="space-y-4">
        <section>
          <div className="mb-1 font-semibold">Primary parts repo</div>
          <p className="mb-2 text-[12px] text-muted">
            Ignite3D reads <code>catalog.json</code> and <code>parts/&#123;sku&#125;.glb</code> from this GitHub repo through jsDelivr. Parts without a .glb use an accurate procedural model.
          </p>
          <div className="flex gap-2">
            <input
              className="field flex-1 font-mono text-[12px]"
              value={repoTxt}
              onChange={(e) => setRepoTxt(e.target.value)}
              placeholder="owner/repo@branch:folder or https://github.com/owner/repo"
            />
            <Btn
              onClick={() => {
                const r = parseRepo(repoTxt);
                if (!r) return st.toast('Use owner/repo, owner/repo@branch:folder or a GitHub URL', 'error');
                const c = { ...cfg, primary: r };
                setCfg(c);
                setRepoTxt(repoLabel(r));
                apply(c);
              }}
            >
              Apply
            </Btn>
            <Btn
              tone="ghost"
              onClick={() => {
                const c = { ...cfg, primary: DEFAULT_REPO };
                setCfg(c);
                setRepoTxt(repoLabel(DEFAULT_REPO));
                apply(c);
              }}
            >
              Default
            </Btn>
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">{cdnBase(cfg.primary)}</div>
          <label className="mt-2 flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={cfg.useCdn} onChange={(e) => setCfg({ ...cfg, useCdn: e.target.checked })} /> Use the CDN (turn off for fully offline use)
          </label>
        </section>
        <section>
          <div className="mb-1 font-semibold">Team repos (custom printed parts)</div>
          <p className="mb-2 text-[12px] text-muted">Paste your team’s GitHub repo. Its catalog.json parts are added to the catalog under “Custom”.</p>
          {cfg.teamRepos.map((r, i) => (
            <div key={i} className="mb-1 flex items-center justify-between rounded-md bg-panel-2 px-2 py-1 font-mono text-[12px]">
              {repoLabel(r)}
              <button type="button" aria-label="Remove repo" className="text-muted hover:text-danger" onClick={() => setCfg({ ...cfg, teamRepos: cfg.teamRepos.filter((_, k) => k !== i) })}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="field flex-1 font-mono text-[12px]" value={teamTxt} onChange={(e) => setTeamTxt(e.target.value)} placeholder="myteam/ftc-parts" />
            <Btn
              onClick={() => {
                const r = parseRepo(teamTxt);
                if (!r) return st.toast('Use owner/repo or a GitHub URL', 'error');
                setCfg({ ...cfg, teamRepos: [...cfg.teamRepos, r] });
                setTeamTxt('');
              }}
            >
              <Github size={14} /> Add
            </Btn>
          </div>
        </section>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Btn tone="accent" disabled={busy} onClick={() => apply(cfg)}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Save & reload catalog
          </Btn>
          <Btn
            tone="danger"
            onClick={async () => {
              if (!confirm('Clear cached meshes and catalogs? (Custom parts are kept only if you exported them.)')) return;
              await cacheClear();
              clearMissingCache();
              st.toast('Browser cache cleared', 'ok');
            }}
          >
            <Trash2 size={14} /> Clear cache
          </Btn>
          <a className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline" href={`https://github.com/${cfg.primary.owner}/${cfg.primary.repo}`} target="_blank" rel="noreferrer">
            Open repo <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </Modal>
  );
}
