import { useEffect, useMemo, useState } from 'react';
import { Bolt, Copy, Eye, EyeOff, FlipHorizontal2, Ghost, Group, Trash2, Ungroup } from 'lucide-react';
import { Euler, Quaternion, Vector3 } from 'three';
import { useCadStore } from '../store/useCadStore';
import { massProps, robotBounds, sizeCheck } from '../lib/metrics';
import { SNAP_COLORS } from '../lib/snap';
import type { Quat, SnapType, Vec3 } from '../types/cad';
import { Btn, Section } from './ui';
import { loadExample } from '../lib/loadExample';
import { viewportBus } from '../viewport/Viewport';

function NumField({ value, onCommit, suffix, testid }: { value: number; onCommit: (v: number) => void; suffix: string; testid?: string }) {
  const [txt, setTxt] = useState(value.toFixed(2));
  useEffect(() => setTxt(value.toFixed(2)), [value]);
  const commit = () => {
    const v = Number(txt);
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-9) onCommit(v);
    else setTxt(value.toFixed(2));
  };
  return (
    <label className="flex items-center gap-1">
      <input
        data-testid={testid}
        className="field w-full px-1.5 py-1 text-right font-mono text-[12px] num"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setTxt(value.toFixed(2));
          e.stopPropagation();
        }}
      />
      <span className="w-5 text-[10px] text-muted">{suffix}</span>
    </label>
  );
}

const AX = ['X', 'Y', 'Z'] as const;
const AXC = ['text-red-500', 'text-green-500', 'text-blue-500'];

function RobotSummary() {
  const instances = useCadStore((s) => s.instances);
  const catalog = useCadStore((s) => s.catalog);
  const vv = useCadStore((s) => s.visualVersion);
  const m = useMemo(() => massProps(instances, catalog), [instances, catalog]);
  const chk = useMemo(() => sizeCheck(robotBounds(instances, catalog)), [instances, catalog, vv]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useCadStore();
  return (
    <>
      <Section title="Robot">
        <dl className="grid grid-cols-2 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted">Parts</dt>
          <dd className="text-right num" data-testid="part-count">
            {m.count}
          </dd>
          <dt className="text-muted">Weight</dt>
          <dd className="text-right num">
            {(m.grams / 1000).toFixed(2)} kg · {m.lbs.toFixed(2)} lb
          </dd>
          <dt className="text-muted">Cost</dt>
          <dd className="text-right num">${m.priceUsd.toFixed(2)}</dd>
          <dt className="text-muted">Size (in)</dt>
          <dd className={`text-right num ${chk.over ? 'font-semibold text-danger' : ''}`}>
            {(chk.size.x / 25.4).toFixed(1)} × {(chk.size.z / 25.4).toFixed(1)} × {(chk.size.y / 25.4).toFixed(1)}
          </dd>
          <dt className="text-muted">CoG (mm)</dt>
          <dd className="text-right num">{m.cog ? `${m.cog.x.toFixed(0)}, ${m.cog.y.toFixed(0)}, ${m.cog.z.toFixed(0)}` : '—'}</dd>
        </dl>
        {chk.over && <div className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[12px] text-danger">Over 18″ in {chk.axes.join(', ')}. FTC robots must start inside an 18″ cube.</div>}
      </Section>
      <Section title="Get started">
        <ol className="list-decimal space-y-1.5 pl-4 text-[12.5px] text-muted">
          <li>
            Click a part in the <b className="text-ink">catalog</b> on the left.
          </li>
          <li>
            Hover a hole on a placed part — <span className="text-accent">orange rings</span> show where it can snap. Click to place.
          </li>
          <li>
            <kbd>R</kbd> rotates 90°, <kbd>Tab</kbd> picks a different hole, <kbd>Esc</kbd> stops placing.
          </li>
          <li>
            Press <kbd>J</kbd> (Fasten Joint) to add screws and nuts automatically.
          </li>
          <li>
            <b className="text-ink">Export → STEP</b> and import it into Onshape.
          </li>
        </ol>
        {instances.length === 0 && (
          <Btn
            data-testid="load-example"
            tone="accent"
            className="mt-3 w-full justify-center"
            onClick={() => {
              void loadExample();
              st.toast('Loaded the example drivetrain — every screw was placed by Smart Fasten.', 'ok');
              setTimeout(() => viewportBus.fit(), 50);
            }}
          >
            Load example drivetrain
          </Btn>
        )}
        {instances.length < (st.backupBuild?.instances.length ?? 0) / 2 && st.backupBuild && (
          <Btn
            data-testid="restore-backup"
            className="mt-2 w-full justify-center"
            onClick={() => {
              const b = st.backupBuild!;
              st.setInstances(b.instances);
              st.toast(`Restored your earlier build (${b.instances.length} parts) — Ctrl+Z to undo`, 'ok');
              setTimeout(() => viewportBus.fit(), 50);
            }}
          >
            Restore earlier build ({st.backupBuild.instances.length} parts · {new Date(st.backupBuild.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})
          </Btn>
        )}
      </Section>
    </>
  );
}

export function Inspector() {
  const st = useCadStore();
  const sel = useMemo(() => st.instances.filter((i) => st.selection.includes(i.instanceId)), [st.instances, st.selection]);
  const one = sel.length === 1 ? sel[0] : null;
  const part = one ? st.catalog[one.sku] : null;

  if (!sel.length)
    return (
      <aside data-testid="inspector" className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel">
        <RobotSummary />
      </aside>
    );

  const setPos = (k: number, v: number) => {
    if (!one) return;
    const p = [...one.position] as Vec3;
    p[k] = v;
    st.updateTransforms({ [one.instanceId]: { position: p, quaternion: one.quaternion } });
  };
  const euler = one ? new Euler().setFromQuaternion(new Quaternion(...one.quaternion), 'XYZ') : null;
  const setRot = (k: number, deg: number) => {
    if (!one || !euler) return;
    const e = [euler.x, euler.y, euler.z];
    e[k] = (deg * Math.PI) / 180;
    const q = new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2], 'XYZ'));
    st.updateTransforms({ [one.instanceId]: { position: one.position, quaternion: [q.x, q.y, q.z, q.w] as Quat } });
  };
  const totalMass = sel.reduce((a, i) => a + (st.catalog[i.sku]?.massGrams ?? 0), 0);
  const snapCounts: Partial<Record<SnapType, number>> = {};
  part?.snapPoints.forEach((s) => (snapCounts[s.type] = (snapCounts[s.type] ?? 0) + 1));

  return (
    <aside data-testid="inspector" className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel">
      <Section title={one ? 'Part' : `${sel.length} parts selected`}>
        {one && part ? (
          <div>
            <div className="text-[14px] font-semibold leading-snug" data-testid="sel-name">
              {part.name}
            </div>
            <div className="mt-0.5 font-mono text-[11.5px] text-muted">{part.sku}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11.5px]">
              <div className="rounded-md bg-panel-2 py-1.5">
                <div className="text-muted">Mass</div>
                <div className="num font-medium">{part.massGrams} g</div>
              </div>
              <div className="rounded-md bg-panel-2 py-1.5">
                <div className="text-muted">Price</div>
                <div className="num font-medium">${part.priceUsd.toFixed(2)}</div>
              </div>
              <div className="rounded-md bg-panel-2 py-1.5">
                <div className="text-muted">Holes</div>
                <div className="num font-medium">{part.snapPoints.length}</div>
              </div>
            </div>
            {one.groupId && <div className="mt-2 text-[11.5px] text-muted">In a sub-assembly group (Ctrl+Shift+G to ungroup)</div>}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted">
            Total mass <span className="num text-ink">{totalMass.toFixed(1)} g</span>
          </div>
        )}
      </Section>
      {one && euler && (
        <Section title="Transform">
          <div className="mb-1 text-[11px] text-muted">Position (mm)</div>
          <div className="grid grid-cols-[14px_1fr] items-center gap-x-1.5 gap-y-1">
            {AX.map((a, k) => (
              <div key={a} className="contents">
                <span className={`text-[11px] font-semibold ${AXC[k]}`}>{a}</span>
                <NumField testid={`pos-${a}`} value={one.position[k]} suffix="mm" onCommit={(v) => setPos(k, v)} />
              </div>
            ))}
          </div>
          <div className="mb-1 mt-3 text-[11px] text-muted">Rotation (°, XYZ Euler)</div>
          <div className="grid grid-cols-[14px_1fr] items-center gap-x-1.5 gap-y-1">
            {AX.map((a, k) => (
              <div key={a} className="contents">
                <span className={`text-[11px] font-semibold ${AXC[k]}`}>{a}</span>
                <NumField testid={`rot-${a}`} value={([euler.x, euler.y, euler.z][k] * 180) / Math.PI} suffix="°" onCommit={(v) => setRot(k, v)} />
              </div>
            ))}
          </div>
          {one.snapAxis && (
            <div className="mt-2 text-[11px] text-muted">
              Mated axis ({new Vector3(...one.snapAxis).toArray().map((x) => x.toFixed(2)).join(', ')}) — <kbd>[</kbd> <kbd>]</kbd> slide, <kbd>R</kbd> rotate
            </div>
          )}
        </Section>
      )}
      <Section title="Actions">
        <div className="grid grid-cols-2 gap-1.5">
          <Btn onClick={st.toggleHidden}>
            <EyeOff size={14} /> Hide <kbd className="ml-auto">H</kbd>
          </Btn>
          <Btn active={sel.every((i) => i.ghosted)} onClick={st.toggleGhost}>
            <Ghost size={14} /> X-Ray <kbd className="ml-auto">G</kbd>
          </Btn>
          <Btn onClick={st.duplicateSelected}>
            <Copy size={14} /> Duplicate
          </Btn>
          <Btn onClick={() => st.mirrorSelected('x')}>
            <FlipHorizontal2 size={14} /> Mirror
          </Btn>
          <Btn onClick={st.groupSelected} disabled={sel.length < 2}>
            <Group size={14} /> Group
          </Btn>
          <Btn onClick={st.ungroupSelected} disabled={!sel.some((i) => i.groupId)}>
            <Ungroup size={14} /> Ungroup
          </Btn>
          <Btn onClick={() => st.fastenJoint()}>
            <Bolt size={14} /> Fasten
          </Btn>
          <Btn tone="danger" onClick={st.removeSelected}>
            <Trash2 size={14} /> Delete
          </Btn>
        </div>
        <Btn tone="ghost" className="mt-1.5" onClick={st.unhideAll}>
          <Eye size={14} /> Unhide all
        </Btn>
      </Section>
      {part && (
        <Section title="Snap points">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(snapCounts).map(([t, n]) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-[11px]">
                <span className="h-2 w-2 rounded-full" style={{ background: SNAP_COLORS[t as SnapType] }} />
                {t} <span className="text-muted num">×{n}</span>
              </span>
            ))}
          </div>
          <details className="mt-2 text-[11px]">
            <summary className="cursor-pointer text-muted">Local coordinates</summary>
            <div className="mt-1 max-h-48 overflow-y-auto font-mono text-[10.5px]">
              {part.snapPoints.slice(0, 200).map((s) => (
                <div key={s.id} className="flex justify-between gap-2 border-b border-line/50 py-0.5">
                  <span style={{ color: SNAP_COLORS[s.type] }}>{s.id}</span>
                  <span className="text-muted num">
                    {s.position.map((x) => x.toFixed(1)).join(',')} n({s.normal.map((x) => x.toFixed(0)).join(',')})
                    {s.tapped ? ' T' : ''}
                    {s.male ? ' M' : ''}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </Section>
      )}
    </aside>
  );
}
