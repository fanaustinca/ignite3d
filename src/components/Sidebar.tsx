import { useMemo, useState } from 'react';
import { ChevronRight, Cloud, HardDrive, Plus, Search, Shapes, Sparkles, Trash2 } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { CATEGORIES, type CatalogPart, type Category } from '../types/cad';
import { requestUpgrade } from '../services/visuals';
import { deleteCustomPart } from '../services/customParts';
import type { AssetSource } from '../services/assetLoader';
import { Tip } from './ui';

const STATUS: Record<AssetSource, { label: string; cls: string }> = {
  procedural: { label: 'Procedural model (no .glb in repo yet)', cls: 'bg-zinc-400' },
  loading: { label: 'Checking CDN…', cls: 'bg-amber-400 animate-pulse' },
  cached: { label: 'Real mesh, cached in browser', cls: 'bg-emerald-500' },
  remote: { label: 'Real mesh from GitHub CDN', cls: 'bg-sky-500' },
  local: { label: 'Real mesh from this site', cls: 'bg-sky-500' },
  custom: { label: 'Your custom part (IndexedDB)', cls: 'bg-violet-500' },
};

function PartRow({ p }: { p: CatalogPart }) {
  const placing = useCadStore((s) => s.placingSku === p.sku);
  const status = useCadStore((s) => s.assetStatus[p.sku]);
  const startPlacing = useCadStore((s) => s.startPlacing);
  const st = STATUS[status ?? (p.isCustom ? 'custom' : 'procedural')];
  return (
    <div
      role="button"
      tabIndex={0}
      data-sku={p.sku}
      onMouseEnter={() => requestUpgrade(p.sku)}
      onClick={() => startPlacing(placing ? null : p.sku)}
      onKeyDown={(e) => e.key === 'Enter' && startPlacing(p.sku)}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${placing ? 'bg-accent-soft ring-1 ring-accent/50' : 'hover:bg-panel-2'}`}
    >
      <span title={st.label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.cls}`} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12.5px] ${placing ? 'text-accent font-medium' : ''}`}>{p.name}</div>
        <div className="flex gap-2 font-mono text-[10.5px] text-muted">
          <span>{p.sku}</span>
          <span className="num">{p.massGrams >= 100 ? p.massGrams.toFixed(0) : p.massGrams.toFixed(1)} g</span>
        </div>
      </div>
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

export function Sidebar() {
  const catalog = useCadStore((s) => s.catalog);
  const order = useCadStore((s) => s.catalogOrder);
  const status = useCadStore((s) => s.assetStatus);
  const set = useCadStore((s) => s.set);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ Structure: true });
  const parts = useMemo(() => order.map((k) => catalog[k]).filter(Boolean), [order, catalog]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return parts;
    const words = t.split(/\s+/);
    return parts.filter((p) => {
      const hay = `${p.name} ${p.sku} ${p.series ?? ''} ${p.category} ${(p.tags ?? []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [parts, q]);
  const byCat = useMemo(() => {
    const m = new Map<Category, Map<string, CatalogPart[]>>();
    for (const p of filtered) {
      const c = m.get(p.category) ?? new Map<string, CatalogPart[]>();
      m.set(p.category, c);
      const s = p.series ?? p.category;
      c.set(s, [...(c.get(s) ?? []), p]);
    }
    return m;
  }, [filtered]);
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
        {CATEGORIES.filter((c) => byCat.has(c)).map((cat) => {
          const series = byCat.get(cat)!;
          const n = [...series.values()].reduce((a, l) => a + l.length, 0);
          const isOpen = q ? true : !!open[cat];
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
                [...series].map(([name, list]) => (
                  <div key={name} className="ml-3 mt-1 border-l border-line pl-2">
                    <div className="px-2 pb-0.5 pt-1 text-[10.5px] font-medium uppercase tracking-wide text-muted">{name}</div>
                    {list.map((p) => (
                      <PartRow key={p.sku} p={p} />
                    ))}
                  </div>
                ))}
            </div>
          );
        })}
        {!filtered.length && <div className="p-4 text-center text-[12.5px] text-muted">No parts match “{q}”.</div>}
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
