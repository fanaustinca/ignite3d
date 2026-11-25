import {
  Bolt,
  Box,
  Cloud,
  CircleHelp,
  ClipboardList,
  Crosshair,
  Download,
  FlipHorizontal2,
  Github,
  Magnet,
  Maximize,
  MessageSquare,
  PackagePlus,
  Moon,
  MousePointer2,
  Move3d,
  Redo2,
  Rotate3d,
  Share2,
  ShieldCheck,
  Sun,
  Undo2,
  Wrench,
} from 'lucide-react';
import { useStore } from 'zustand';
import { redo, undo, useCadStore } from '../store/useCadStore';
import { LogoMark, Wordmark } from './Logo';
import { Btn, Divider, Tip } from './ui';
import { APP_VERSION } from '../version';
import { viewportBus } from '../viewport/Viewport';
import { useCheckStore } from '../services/robotCheck';
import { FEEDBACK_FORM, PART_REQUEST_FORM } from '../config/links';
import { useCloudStore } from '../services/cloud';

export function Toolbar() {
  const s = useCadStore();
  const canUndo = useStore(useCadStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(useCadStore.temporal, (t) => t.futureStates.length > 0);
  const hasSel = s.selection.length > 0;
  const check = useCheckStore();
  const nCol = check.collisions.length;
  const cloud = useCloudStore();
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <div className="mr-2 flex items-center gap-2 pl-1">
        <LogoMark size={26} />
        <Wordmark />
        <span data-testid="version" className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
          v{APP_VERSION}
        </span>
      </div>
      <Divider />
      <Tip label="Select & move" keys="Esc">
        <Btn active={s.tool === 'select' && !s.placingSku} onClick={() => s.set({ tool: 'select', placingSku: null })} aria-label="Select tool">
          <MousePointer2 size={16} />
        </Btn>
      </Tip>
      <Tip label="Smart Fasten tool — click an M4 hole in a joint" keys="F">
        <Btn data-testid="tool-fasten" active={s.tool === 'fasten'} onClick={() => s.set({ tool: s.tool === 'fasten' ? 'select' : 'fasten', placingSku: null })}>
          <Wrench size={16} />
          <span className="hidden min-[1600px]:inline">Fasten</span>
        </Btn>
      </Tip>
      <Tip label="Fasten Joint — auto-screw every aligned joint of the selection (or whole robot)" keys="J">
        <Btn data-testid="fasten-joint" onClick={() => s.fastenJoint()}>
          <Bolt size={16} />
          <span className="hidden min-[1600px]:inline">Fasten Joint</span>
        </Btn>
      </Tip>
      <Divider />
      <Tip label={s.snapEnabled ? 'Hole snapping ON — click to turn off (free placement + gizmo)' : 'Hole snapping OFF — click to turn on'} keys="S">
        <Btn data-testid="snap-toggle" active={s.snapEnabled} onClick={() => s.set({ snapEnabled: !s.snapEnabled })}>
          <Magnet size={16} />
          <span>Snap {s.snapEnabled ? 'ON' : 'OFF'}</span>
          <kbd>S</kbd>
        </Btn>
      </Tip>
      <Tip label="Gizmo: move" keys="W">
        <Btn active={s.gizmoMode === 'translate'} onClick={() => s.set({ gizmoMode: 'translate' })} aria-label="Translate gizmo">
          <Move3d size={16} />
        </Btn>
      </Tip>
      <Tip label="Gizmo: rotate" keys="E">
        <Btn active={s.gizmoMode === 'rotate'} onClick={() => s.set({ gizmoMode: 'rotate' })} aria-label="Rotate gizmo">
          <Rotate3d size={16} />
        </Btn>
      </Tip>
      <Tip label="Move increment">
        <select aria-label="Grid increment" className="field py-1 text-[12px]" value={s.gridStep} onChange={(e) => s.set({ gridStep: Number(e.target.value) })}>
          <option value={1}>1 mm</option>
          <option value={8}>8 mm</option>
          <option value={16}>16 mm</option>
          <option value={0}>Free</option>
        </select>
      </Tip>
      <Tip label="Rotate increment">
        <select aria-label="Angle increment" className="field py-1 text-[12px]" value={s.angleStep} onChange={(e) => s.set({ angleStep: Number(e.target.value) })}>
          <option value={15}>15°</option>
          <option value={45}>45°</option>
          <option value={90}>90°</option>
          <option value={0}>Free</option>
        </select>
      </Tip>
      <Divider />
      <Tip label="Mirror selection across the left/right plane (Shift+M: front/back)" keys="M">
        <Btn disabled={!hasSel} onClick={() => s.mirrorSelected('x')} aria-label="Mirror">
          <FlipHorizontal2 size={16} />
        </Btn>
      </Tip>
      <Tip label='18" sizing cube' keys="B">
        <Btn data-testid="sizing-toggle" active={s.showSizingCube} onClick={() => s.set({ showSizingCube: !s.showSizingCube })}>
          <Box size={16} />
          <span className="hidden min-[1700px]:inline">18″</span>
        </Btn>
      </Tip>
      <Tip label="Center of gravity" keys="C">
        <Btn active={s.showCoG} onClick={() => s.set({ showCoG: !s.showCoG })}>
          <Crosshair size={16} />
          <span className="hidden min-[1700px]:inline">CoG</span>
        </Btn>
      </Tip>
      <Tip label="Robot Check — collisions, joints & screws, tip-over stability" keys="K">
        <Btn data-testid="open-check" active={check.open} onClick={() => check.set({ open: !check.open, focus: null })} className="relative">
          <ShieldCheck size={16} />
          <span className="hidden lg:inline">Check</span>
          {nCol > 0 && (
            <span data-testid="collision-badge" className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white num">
              {nCol}
            </span>
          )}
        </Btn>
      </Tip>
      <Tip label="Zoom to fit" keys=".">
        <Btn onClick={() => viewportBus.fit()} aria-label="Zoom to fit">
          <Maximize size={16} />
        </Btn>
      </Tip>
      <Divider />
      <Tip label="Undo" keys="Ctrl+Z">
        <Btn disabled={!canUndo} onClick={undo} aria-label="Undo">
          <Undo2 size={16} />
        </Btn>
      </Tip>
      <Tip label="Redo" keys="Ctrl+Y">
        <Btn disabled={!canRedo} onClick={redo} aria-label="Redo">
          <Redo2 size={16} />
        </Btn>
      </Tip>
      <div className="flex-1" />
      <Tip label="Missing a part? Request it">
        <a data-testid="part-request-link" href={PART_REQUEST_FORM} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-ink hover:bg-panel-2">
          <PackagePlus size={16} />
          <span className="hidden min-[1800px]:inline">Request a part</span>
        </a>
      </Tip>
      <Tip label="Send feedback / report a bug">
        <a data-testid="feedback-link" href={FEEDBACK_FORM} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-ink hover:bg-panel-2">
          <MessageSquare size={16} />
          <span className="hidden min-[1800px]:inline">Feedback</span>
        </a>
      </Tip>
      <Tip label="Help & shortcuts" keys="?">
        <Btn data-testid="open-help" onClick={() => s.set({ modal: 'help' })}>
          <CircleHelp size={16} />
          <span className="hidden min-[1800px]:inline">Help</span>
        </Btn>
      </Tip>
      <Tip label="GitHub parts repo & settings">
        <Btn onClick={() => s.set({ modal: 'settings' })} aria-label="Settings">
          <Github size={16} />
        </Btn>
      </Tip>
      <Tip label={s.theme === 'dark' ? 'Light mode' : 'Dark mode'}>
        <Btn data-testid="theme-toggle" onClick={() => s.set({ theme: s.theme === 'dark' ? 'light' : 'dark' })} aria-label="Toggle theme">
          {s.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Btn>
      </Tip>
      <Divider />
      <Tip label={cloud.code ? `Cloud file ${cloud.code} — saves online` : 'Cloud files — save online with a 6-digit code'}>
        <Btn data-testid="open-cloud" active={!!cloud.code} onClick={() => s.set({ modal: 'cloud' })}>
          <Cloud size={16} className={cloud.status === 'error' ? 'text-red-500' : cloud.status === 'saving' || cloud.status === 'connecting' ? 'animate-pulse' : ''} />
          <span className="hidden min-[1700px]:inline num">{cloud.code ?? 'Cloud'}</span>
        </Btn>
      </Tip>
      <Tip label="Share link">
        <Btn data-testid="open-share" onClick={() => s.set({ modal: 'share' })}>
          <Share2 size={16} />
          <span className="hidden min-[1700px]:inline">Share</span>
        </Btn>
      </Tip>
      <Tip label="Bill of materials">
        <Btn data-testid="open-bom" onClick={() => s.set({ modal: 'bom' })}>
          <ClipboardList size={16} />
          <span className="hidden min-[1700px]:inline">BOM</span>
        </Btn>
      </Tip>
      <Btn data-testid="open-export" tone="accent" className="ml-1 px-3" onClick={() => s.set({ modal: 'export' })}>
        <Download size={16} /> Export
      </Btn>
    </header>
  );
}
