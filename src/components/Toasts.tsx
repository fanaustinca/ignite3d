import { useCadStore } from '../store/useCadStore';

const TONE = {
  info: 'border-line',
  ok: 'border-green-500/60',
  warn: 'border-amber-500/70',
  error: 'border-red-500/70',
};

export function Toasts() {
  const toasts = useCadStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto max-w-xl rounded-lg border-l-4 ${TONE[t.kind]} border border-line bg-panel px-3.5 py-2 text-[12.5px] shadow-lg`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
