import { useMemo } from 'react';
import { useCadStore } from '../store/useCadStore';
import { massProps } from '../lib/metrics';
import { APP_VERSION, TEAM_CREDIT } from '../version';

export function StatusBar() {
  const st = useCadStore();
  const m = useMemo(() => massProps(st.instances, st.catalog), [st.instances, st.catalog]);
  const placing = st.placingSku ? st.catalog[st.placingSku] : null;
  let hint: React.ReactNode;
  if (placing)
    hint = (
      <>
        Placing <b className="text-accent">{placing.name}</b> — click to place · <kbd>R</kbd> rotate 90° · <kbd>Shift+R</kbd> 45° · <kbd>Tab</kbd> next hole · <kbd>S</kbd> snap {st.snapEnabled ? 'on' : 'off'} ·{' '}
        <kbd>Esc</kbd> done
      </>
    );
  else if (st.tool === 'fasten')
    hint = (
      <>
        <b className="text-accent">Smart Fasten</b> — click an M4 hole where two parts overlap. Screw length is picked from the stack thickness. <kbd>Esc</kbd> exit
      </>
    );
  else if (st.selection.length)
    hint = (
      <>
        Drag an arrow to move, a ring to rotate ({st.angleStep ? `${st.angleStep}° steps` : 'free'}) · <kbd>W</kbd>/<kbd>E</kbd> move/rotate · <kbd>[</kbd> <kbd>]</kbd> slide on axis · <kbd>H</kbd> hide · <kbd>G</kbd> x-ray · <kbd>Del</kbd> delete · <kbd>Ctrl+D</kbd> duplicate
      </>
    );
  else
    hint = (
      <>
        Pick a part on the left · drag to orbit · right-drag to pan · scroll to zoom · <kbd>?</kbd> help
      </>
    );
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11.5px] text-muted">
      <div className="min-w-0 flex-1 truncate" data-testid="hint">
        {hint}
      </div>
      {st.lastSnapInfo && <div className="hidden max-w-[34%] truncate text-ink/80 xl:block" data-testid="snap-info">{st.lastSnapInfo}</div>}
      <div className="num whitespace-nowrap" data-testid="mass-readout">
        {m.count} parts · {(m.grams / 1000).toFixed(2)} kg ({m.lbs.toFixed(2)} lb) · ${m.priceUsd.toFixed(0)}
      </div>
      <div className="whitespace-nowrap border-l border-line pl-3" data-testid="credit">
        <span className="font-medium text-accent">{TEAM_CREDIT}</span> · v{APP_VERSION}
      </div>
    </footer>
  );
}
