import type { ReactNode, ButtonHTMLAttributes } from 'react';

export function Tip({ label, keys, children, side = 'bottom' }: { label: string; keys?: string; children: ReactNode; side?: 'bottom' | 'top' | 'right' }) {
  const pos = side === 'bottom' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : side === 'top' ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' : 'left-full ml-2 top-1/2 -translate-y-1/2';
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${pos} z-50 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-ink opacity-0 shadow-lg transition-opacity delay-300 group-hover/tip:opacity-100`}
      >
        {label}
        {keys && <kbd className="ml-1.5">{keys}</kbd>}
      </span>
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: 'default' | 'accent' | 'danger' | 'ghost' };

export function Btn({ active, tone = 'default', className = '', children, ...rest }: BtnProps) {
  const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none select-none';
  const tones = {
    default: active ? 'bg-accent-soft text-accent ring-1 ring-accent/40' : 'text-ink hover:bg-panel-2',
    accent: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
    danger: 'text-danger hover:bg-red-500/10',
    ghost: 'text-muted hover:text-ink hover:bg-panel-2',
  };
  return (
    <button type="button" className={`${base} ${tones[tone]} px-2 py-1.5 ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Divider() {
  return <span className="mx-1 h-6 w-px bg-line" />;
}

export function Modal({ title, onClose, children, wide, testid }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; testid?: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        data-testid={testid}
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[90vh] w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <button type="button" aria-label="Close" className="rounded-md px-2 py-1 text-muted hover:bg-panel-2 hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-[13px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
