import { PART_REQUEST_FORM } from '../config/links';
import { useMemo, useState } from 'react';
import { ChevronRight, Cloud, HardDrive, Package, Plus, Search, Shapes, Sparkles, Trash2, X } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { CATEGORIES, type CatalogPart, type Category } from '../types/cad';
import { requestUpgrade } from '../services/visuals';
import { deleteCustomPart } from '../services/customParts';
import type { AssetSource } from '../services/assetLoader';
import { Tip } from './ui';
import { familyOf, familyTitle, shortNames } from '../lib/partNames';
import { useThumb } from '../services/thumbs';
import kitsData from '../data/kits.json';

/** goBILDA kits / bundles and the catalogue parts they contain (qty = pieces), from the kit pages' bills of materials. */
export interface Kit {
  sku: string;
  name: string;
  items: Record<string, number>;
  missing: { sku: string; name: string }[];
}
export const KITS = kitsData as unknown as Kit[];

const STATUS: Record<AssetSource, { label: string; cls: string }> = {
  procedural: { label: 'Procedural model (no .glb in repo yet)', cls: 'bg-zinc-400' },
  loading: { label: 'Checking CDN…', cls: 'bg-amber-400 animate-pulse' },
  cached: { label: 'Real mesh, cached in browser', cls: 'bg-emerald-500' },
  remote: { label: 'Real mesh from GitHub CDN', cls: 'bg-sky-500' },
  local: { label: 'Real mesh from this site', cls: 'bg-sky-500' },
  custom: { label: 'Your custom part (IndexedDB)', cls: 'bg-violet-500' },
};

type Hover = { part: CatalogPart; short: string; rect: DOMRect } | null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function PartRow({ p, short, onHover, qty }: { p: CatalogPart; short: string; onHover: (h: Hover) => void; qty?: number }) {
  const placing = useCadStore((s) => s.placingSku === p.sku);
  const status = useCadStore((s) => s.assetStatus[p.sku]);
  const startPlacing = useCadStore((s) => s.startPlacing);
  const st = STATUS[status ?? (p.isCustom ? 'custom' : 'procedural')];
  return (
    <div
      role="button"
      tabIndex={0}
      data-sku={p.sku}
      title={p.name}
      onMouseEnter={(e) => {
        requestUpgrade(p.sku);
        const rect = e.currentTarget.getBoundingClientRect();
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => onHover({ part: p, short, rect }), 140);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimer);
        onHover(null);
      }}
      onClick={() => startPlacing(placing ? null : p.sku)}
      onKeyDown={(e) => e.key === 'Enter' && startPlacing(p.sku)}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${placing ? 'bg-accent-soft ring-1 ring-accent/50' : 'hover:bg-panel-2'}`}
    >
      <span title={st.label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.cls}`} />
      <div className={`min-w-0 flex-1 truncate text-[12.5px] ${placing ? 'font-medium text-accent' : ''}`} data-testid="part-name">
        {short}
      </div>
      {qty ? (
        <span data-testid="kit-qty" className="shrink-0 rounded bg-accent-soft px-1 font-mono text-[10.5px] text-accent num">
          ×{qty}
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-[10.5px] text-muted num">{p.massGrams >= 100 ? p.massGrams.toFixed(0) : p.massGrams.toFixed(1)} g</span>
      {p.isCustom && (
        <button
          type="button"
          aria-label="Delete custom part"
          className="hidden rounded p-1 text-muted hover:text-danger group-hover:block"
          onClick={async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete custom part ${p.name}?`)) return;
            await deleteCustomPart(p.sku);
            const s = useCadStore.getState();
            const rest = Object.values(s.catalog).filter((x) => x.sku !== p.sku);
            s.setCatalog(rest);
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

/** Floating card next to the hovered library row: thumbnail, full name, SKU, cost, weight. */
function HoverCard({ h }: { h: NonNullable<Hover> }) {
  const thumb = useThumb(h.part.sku);
  const p = h.part;
  const top = Math.max(8, Math.min(h.rect.top - 24, window.innerHeight - 236));
  const d = p.dimensions;
  return (
    <div
      data-testid="part-hover-card"
      className="pointer-events-none fixed z-50 w-64 rounded-lg border border-line bg-panel p-2.5 shadow-xl"
      style={{ left: h.rect.right + 10, top }}
    >
      <div className="flex gap-2.5">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-panel-2">
          {thumb ? <img src={thumb} alt="" className="h-20 w-20 object-contain" data-testid="part-thumb" /> : <span className="text-[10px] text-muted">loading…</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold leading-tight">{h.short}</div>
          <div className="mt-1 font-mono text-[11px] text-accent" data-testid="hover-sku">
            {p.sku}
          </div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[11.5px] num">
            <dt className="text-muted">Cost</dt>
            <dd data-testid="hover-cost">
              ${p.priceUsd.toFixed(2)}
              {p.pack && p.pack > 1 ? <span className="text-muted"> ea · {p.pack}-pack</span> : null}
            </dd>
            <dt className="text-muted">Weight</dt>
            <dd data-testid="hover-weight">
              {p.massGrams >= 100 ? p.massGrams.toFixed(0) : p.massGrams.toFixed(1)} g · {(p.massGrams / 453.592).toFixed(p.massGrams > 45 ? 2 : 3)} lb
            </dd>
            {d && (
              <>
                <dt className="text-muted">Size</dt>
                <dd>{d.map((x) => (x >= 10 ? x.toFixed(0) : x.toFixed(1))).join(' × ')} mm</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-snug text-muted">{p.name}</div>
    </div>
  );
}

const OPEN_KEY = 'ignite3d-library-open';
function loadOpen(): Record<string, boolean> {
  try {
    return { Structure: true, ...JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') };
  } catch {
    return { Structure: true };
  }
}

export function Sidebar() {
  const catalog = useCadStore((s) => s.catalog);
  const order = useCadStore((s) => s.catalogOrder);
  const status = useCadStore((s) => s.assetStatus);
  const set = useCadStore((s) => s.set);
  const [q, setQ] = useState('');
  const [kitSku, setKitSku] = useState('');
  const kit = KITS.find((k) => k.sku === kitSku);
  const [open, setOpenRaw] = useState<Record<string, boolean>>(loadOpen);
  const [hover, setHover] = useState<Hover>(null);
  const setOpen = (o: Record<string, boolean>) => {
    setOpenRaw(o);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  };
  const parts = useMemo(() => order.map((k) => catalog[k]).filter(Boolean), [order, catalog]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const inKit = kit ? parts.filter((p) => kit.items[p.sku]) : parts;
    if (!t) return inKit;
    const words = t.split(/\s+/);
    return inKit.filter((p) => {
      const hay = `${p.name} ${p.sku} ${p.series ?? ''} ${p.category} ${(p.tags ?? []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [parts, q, kit]);
  const byCat = useMemo(() => {
    const m = new Map<Category, Map<string, CatalogPart[]>>();
    for (const p of filtered) {
      const c = m.get(p.category) ?? new Map<string, CatalogPart[]>();
      m.set(p.category, c);
      const s = familyOf(p);
      c.set(s, [...(c.get(s) ?? []), p]);
    }
    // short names are computed over the whole family (not just the search hits) so they never change
    const names = new Map<string, string>();
    const fam = new Map<string, CatalogPart[]>();
    for (const p of parts) fam.set(p.category + '|' + familyOf(p), [...(fam.get(p.category + '|' + familyOf(p)) ?? []), p]);
    for (const list of fam.values()) for (const [k, v] of shortNames(list)) names.set(k, v);
    return { m, names };
  }, [filtered, parts]);
  const counts = useMemo(() => {
    let real = 0;
    for (const v of Object.values(status)) if (v === 'cached' || v === 'remote' || v === 'local') real++;
    return { total: parts.length, real };
  }, [status, parts]);

  return (
    <aside data-testid="sidebar" className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
      <div className="border-b border-line p-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            data-testid="catalog-search"
            className="field w-full pl-8 text-[13px]"
            placeholder="Search parts, SKUs… (e.g. 435 rpm)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="relative mt-2">
          <Package size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <select
            data-testid="kit-select"
            aria-label="Show the parts of a goBILDA kit"
            className={`field w-full appearance-none pl-8 pr-7 text-[12.5px] ${kit ? 'text-accent' : 'text-muted'}`}
            value={kitSku}
            onChange={(e) => setKitSku(e.target.value)}
          >
            <option value="">All parts (no kit filter)</option>
            {KITS.map((k) => (
              <option key={k.sku} value={k.sku}>
                {k.name}
              </option>
            ))}
          </select>
          {kit && (
            <button type="button" aria-label="Clear kit filter" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink" onClick={() => setKitSku('')}>
              <X size={13} />
            </button>
          )}
        </div>
        {kit && (
          <div data-testid="kit-summary" className="mt-1.5 text-[11px] leading-snug text-muted">
            <span className="num">{Object.values(kit.items).reduce((a, b) => a + b, 0)}</span> pieces · <span className="num">{Object.keys(kit.items).length}</span> part types
            {kit.missing.length > 0 && (
              <span className="ml-1 cursor-help underline decoration-dotted" title={'Not modelled (electronics, wiring, belts, chain, tools…):\n' + kit.missing.map((m) => `${m.sku}  ${m.name}`).join('\n')}>
                +{kit.missing.length} non-CAD items
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          data-testid="open-upload"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-1.5 text-[12.5px] text-muted hover:border-accent hover:text-accent"
          onClick={() => set({ modal: 'upload' })}
        >
          <Plus size={14} /> Upload Custom Part
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {CATEGORIES.filter((c) => byCat.m.has(c)).map((cat) => {
          const series = byCat.m.get(cat)!;
          const n = [...series.values()].reduce((a, l) => a + l.length, 0);
          const isOpen = q || kit ? true : !!open[cat];
          return (
            <div key={cat} className="mb-1">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[12.5px] font-semibold hover:bg-panel-2"
                onClick={() => setOpen({ ...open, [cat]: !isOpen })}
              >
                <ChevronRight size={14} className={`text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                {cat === 'Custom' ? <Sparkles size={13} className="text-violet-500" /> : <Shapes size={13} className="text-accent" />}
                <span className="flex-1 text-left">{cat}</span>
                <span className="rounded bg-panel-2 px-1.5 text-[10.5px] font-normal text-muted num">{n}</span>
              </button>
              {isOpen &&
                [...series].map(([name, list]) => {
                  if (list.length === 1) {
                    // a family of one: no sub-section, just the part with its family name
                    const p = list[0];
                    const sn = byCat.names.get(p.sku) ?? '';
                    const title = familyTitle(name);
                    const label = !sn || title.includes(sn) || sn.includes(title) ? (sn.length > title.length ? sn : title) : `${title} · ${sn}`;
                    return (
                      <div key={name} className="ml-3 border-l border-line pl-1.5">
                        <PartRow p={p} short={label} onHover={setHover} qty={kit?.items[p.sku]} />
                      </div>
                    );
                  }
                  const fk = `${cat}/${name}`;
                  const fOpen = q || kit ? true : series.size === 1 ? open[fk] !== false : !!open[fk];
                  return (
                    <div key={name} className="ml-3 border-l border-line pl-1.5" data-family={name}>
                      <button
                        type="button"
                        data-testid="family-toggle"
                        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11.5px] font-medium text-ink/85 hover:bg-panel-2"
                        onClick={() => setOpen({ ...open, [fk]: !fOpen })}
                        aria-expanded={fOpen}
                      >
                        <ChevronRight size={12} className={`shrink-0 text-muted transition-transform ${fOpen ? 'rotate-90' : ''}`} />
                        <span className="min-w-0 flex-1 truncate" title={name}>
                          {familyTitle(name)}
                        </span>
                        <span className="text-[10px] font-normal text-muted num">{list.length}</span>
                      </button>
                      {fOpen && (
                        <div className="pb-1 pl-2">
                          {list.map((p) => (
                            <PartRow key={p.sku} p={p} short={byCat.names.get(p.sku) ?? p.name} onHover={setHover} qty={kit?.items[p.sku]} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {hover && <HoverCard h={hover} />}
        {!filtered.length && <div className="p-4 text-center text-[12.5px] text-muted">{q ? `No parts match “${q}”${kit ? ' in this kit' : ''}.` : 'No parts.'}</div>}
        <a
          data-testid="sidebar-part-request"
          href={PART_REQUEST_FORM}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-1 mt-2 block rounded-md px-2 py-1.5 text-center text-[11.5px] text-muted hover:bg-panel-2 hover:text-accent"
        >
          Can’t find a part? <span className="font-medium text-accent">Request it →</span>
        </a>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-muted">
        <Tip label="Parts with real .glb meshes (CDN or cache)" side="top">
          <span className="flex items-center gap-1">
            <Cloud size={12} /> {counts.real} meshes
          </span>
        </Tip>
        <Tip label="Every part also has an accurate procedural model" side="top">
          <span className="flex items-center gap-1">
            <HardDrive size={12} /> {counts.total} parts
          </span>
        </Tip>
      </div>
    </aside>
  );
}
