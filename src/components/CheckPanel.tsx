import { useEffect, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { runRobotCheck, useCheckStore } from '../services/robotCheck';
import type { Issue, Level } from '../lib/analysis/strength';
import type { Vec3 } from '../types/cad';
import { viewportBus } from '../viewport/Viewport';
import { Btn } from './ui';

const ICON: Record<Level, JSX.Element> = {
  error: <OctagonAlert size={14} className="shrink-0 text-red-500" />,
  warn: <AlertTriangle size={14} className="shrink-0 text-amber-500" />,
  info: <Info size={14} className="shrink-0 text-sky-500" />,
  ok: <CheckCircle2 size={14} className="shrink-0 text-green-500" />,
};

function focusOn(ids: string[], point?: Vec3) {
  const st = useCadStore.getState();
  const live = ids.filter((id) => st.instances.some((i) => i.instanceId === id));
  if (live.length) st.select(live);
  useCheckStore.getState().set({ focus: live });
  if (point) viewportBus.focus(point);
}

function Chip({ tone, label, value, testid }: { tone: 'red' | 'amber' | 'green' | 'muted'; label: string; value: string; testid?: string }) {
  const c = { red: 'bg-red-500/12 text-red-600 dark:text-red-400', amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-400', green: 'bg-green-500/12 text-green-700 dark:text-green-400', muted: 'bg-panel-2 text-muted' }[tone];
  return (
    <div className={`rounded-lg px-2 py-1.5 ${c}`} data-testid={testid}>
      <div className="text-[15px] font-semibold leading-tight num">{value}</div>
      <div className="text-[10.5px] leading-tight opacity-80">{label}</div>
    </div>
  );
}

function IssueRow({ issue, i }: { issue: Issue; i: number }) {
  return (
    <button
      type="button"
      data-testid="check-issue"
      data-kind={issue.kind}
      data-level={issue.level}
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
      onClick={() => focusOn(issue.ids, issue.point)}
      data-i={i}
    >
      <span className="mt-0.5">{ICON[issue.level]}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium">{issue.title}</span>
        <span className="block text-[11.5px] leading-snug text-muted">{issue.detail}</span>
      </span>
    </button>
  );
}

export function CheckPanel() {
  const cs = useCheckStore();
  const catalog = useCadStore((s) => s.catalog);
  const count = useCadStore((s) => s.instances.length);
  useEffect(() => {
    if (cs.open && !cs.report && !cs.running) void runRobotCheck();
  }, [cs.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (sku: string) => catalog[sku]?.name ?? sku;
  const rep = cs.report;
  const stab = rep?.stability;
  const issues = useMemo(() => rep?.issues.filter((i) => i.kind !== 'stability') ?? [], [rep]);
  if (!cs.open) return null;
  const nCol = cs.collisions.length;
  return (
    <aside
      data-testid="check-panel"
      className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-[340px] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ShieldCheck size={16} className="text-accent" />
        <div className="flex-1 text-[13px] font-semibold">Robot Check</div>
        <Btn tone="ghost" data-testid="check-run" disabled={cs.running} onClick={() => void runRobotCheck()} aria-label="Re-run check">
          {cs.running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          <span>{cs.running ? `${Math.round(cs.progress * 100)}%` : 'Re-run'}</span>
        </Btn>
        <Btn tone="ghost" onClick={() => cs.set({ open: false, focus: null })} aria-label="Close check">
          <X size={14} />
        </Btn>
      </div>
      <div className="overflow-y-auto px-3 py-2 text-[12.5px]">
        {!count && <div className="py-6 text-center text-muted">Place some parts, then check the robot here.</div>}
        {!!count && (
          <>
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              <Chip testid="chip-collisions" tone={nCol ? 'red' : 'green'} value={String(nCol)} label={nCol === 1 ? 'collision' : 'collisions'} />
              <Chip
                testid="chip-joints"
                tone={!rep ? 'muted' : rep.score.loose ? 'red' : rep.score.weak ? 'amber' : 'green'}
                value={rep ? `${rep.score.fastened}/${rep.score.joints}` : '…'}
                label="joints fastened"
              />
              <Chip
                testid="chip-stability"
                tone={!stab ? 'muted' : !stab.ok || stab.tipAngleDeg < 12 ? 'red' : stab.tipAngleDeg < 25 ? 'amber' : 'green'}
                value={!stab ? '…' : stab.ok ? `${stab.tipAngleDeg.toFixed(0)}°` : 'falls'}
                label="tip angle"
              />
            </div>

            <h3 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Collisions</h3>
            {nCol === 0 ? (
              <div className="flex items-center gap-2 px-2 py-1 text-muted">
                {ICON.ok} No parts pass through each other{cs.live ? '' : ' (at the last check)'}.
              </div>
            ) : (
              cs.collisions.slice(0, 60).map((c) => (
                <button
                  key={`${c.a}|${c.b}`}
                  type="button"
                  data-testid="collision-row"
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
                  onClick={() => focusOn([c.a, c.b], c.point)}
                >
                  <span className="mt-0.5">{ICON.error}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium">{name(c.skuA)}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      ↳ {name(c.skuB)} · {c.depth.toFixed(1)} mm deep
                    </span>
                  </span>
                </button>
              ))
            )}
            <label className="mt-1 flex items-center gap-2 px-2 text-[11.5px] text-muted">
              <input type="checkbox" data-testid="live-collisions" checked={cs.live} onChange={(e) => cs.set({ live: e.target.checked })} />
              Check collisions live while building
            </label>

            <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Stability</h3>
            {stab ? (
              <div className="px-2" data-testid="stability">
                {stab.ok ? (
                  <p className="leading-snug">
                    Tips over at <b className="num">{stab.tipAngleDeg.toFixed(0)}°</b> of tilt toward <b>{stab.tipToward}</b>, or{' '}
                    <b className="num">{stab.tipAccelG.toFixed(2)} g</b> of braking / turning in that direction.
                  </p>
                ) : (
                  <p className="font-medium text-red-500">Centre of gravity is outside the ground contacts — the robot falls over.</p>
                )}
                <dl className="mt-1.5 grid grid-cols-2 gap-y-0.5 text-[11.5px]">
                  <dt className="text-muted">CoG height</dt>
                  <dd className="text-right num">{stab.cogHeightMm.toFixed(0)} mm</dd>
                  <dt className="text-muted">CoG off-centre</dt>
                  <dd className="text-right num">{stab.cogOffsetMm.toFixed(0)} mm</dd>
                </dl>
                {rep?.issues
                  .filter((i) => i.kind === 'stability')
                  .map((i, k) => (
                    <IssueRow issue={i} i={k} key={k} />
                  ))}
                <p className="mt-1 text-[11px] text-muted">Orange outline on the floor = support polygon. Above ~25° is comfortable for an FTC robot.</p>
              </div>
            ) : (
              <div className="px-2 text-muted">{cs.running ? 'Checking…' : '—'}</div>
            )}

            <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Structure</h3>
            {rep && (
              <p className="px-2 pb-1 text-[11.5px] text-muted" data-testid="structure-summary">
                {rep.score.joints} bolted joints · {rep.score.fastened} fastened · {rep.score.weak} single-screw · {rep.score.loose} loose · {rep.score.attached}/{rep.score.parts} parts attached
              </p>
            )}
            {rep && !issues.length && (
              <div className="flex items-center gap-2 px-2 py-1 text-muted">
                {ICON.ok} Every joint has screws and every part is attached.
              </div>
            )}
            {issues.slice(0, 80).map((i, k) => (
              <IssueRow issue={i} i={k} key={k} />
            ))}
            {issues.length > 80 && <p className="px-2 text-muted">…and {issues.length - 80} more</p>}
            <p className="mt-3 border-t border-line px-2 pt-2 text-[10.5px] leading-snug text-muted">
              Collisions use the real goBILDA meshes (overlap deeper than 0.4 mm; screws and shafts in their holes are expected). Strength is judged from the joints: screws per
              joint, nuts or threaded holes, bearings per shaft. It is not a stress simulation.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
