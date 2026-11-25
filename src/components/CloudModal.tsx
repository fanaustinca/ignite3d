import { useEffect, useState } from 'react';
import { Check, Cloud, CloudOff, Copy, Link2, Loader2, LogOut, RotateCcw, Trash2 } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import {
  cloudConfigured,
  cloudLink,
  createCloudFile,
  dropStash,
  forgetCode,
  leaveCloud,
  openCloudFile,
  renameCloudFile,
  restoreStash,
  retryCloud,
  useCloudStore,
} from '../services/cloud';
import { Btn, Modal } from './ui';
import { viewportBus } from '../viewport/Viewport';

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function CopyBtn({ text, label, testid }: { text: string; label: string; testid?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Btn
      data-testid={testid}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard blocked */
        }
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? <Check size={14} /> : label === 'Copy link' ? <Link2 size={14} /> : <Copy size={14} />} {ok ? 'Copied' : label}
    </Btn>
  );
}

export function CloudStatusText() {
  const c = useCloudStore();
  if (!c.code) return null;
  const t = { off: '', connecting: 'Connecting…', saving: 'Saving online…', saved: 'Saved online', error: 'Not saved online' }[c.status];
  const tone = c.status === 'error' ? 'text-red-600 dark:text-red-400' : c.status === 'saved' ? 'text-green-600 dark:text-green-400' : 'text-muted';
  return <span className={tone}>{t}</span>;
}

export function CloudModal() {
  const st = useCadStore();
  const c = useCloudStore();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState(c.name);
  useEffect(() => setFileName(c.name), [c.name]);
  const close = () => st.set({ modal: null });
  const custom = st.instances.some((i) => st.catalog[i.sku]?.isCustom);

  if (!cloudConfigured())
    return (
      <Modal testid="cloud-modal" title="Cloud files" onClose={close}>
        <div className="flex items-start gap-3">
          <CloudOff size={20} className="mt-0.5 shrink-0 text-muted" />
          <div>
            <p className="font-medium">Cloud save isn’t connected on this site yet.</p>
            <p className="mt-1 text-muted">
              Paste your Firebase web-app config into <code>src/config/firebase.ts</code> (or set the <code>VITE_FIREBASE_*</code> variables) and publish
              <code> firestore.rules</code>. Your build is still saved in this browser automatically.
            </p>
          </div>
        </div>
      </Modal>
    );

  const open = async (k: string) => {
    setBusy(true);
    const ok = await openCloudFile(k);
    setBusy(false);
    if (ok) {
      close();
      setTimeout(() => viewportBus.fit(), 300);
    }
  };

  return (
    <Modal testid="cloud-modal" title="Cloud files" onClose={close}>
      {c.error && (
        <div data-testid="cloud-error" className="mb-3 flex items-center justify-between gap-2 rounded-md bg-red-500/10 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">
          <span>{c.error}</span>
          {c.code && c.status === 'error' && (
            <Btn tone="ghost" onClick={retryCloud}>
              <RotateCcw size={13} /> Retry
            </Btn>
          )}
        </div>
      )}

      {c.code ? (
        <section data-testid="cloud-current">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-panel-2 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Access code</div>
              <div data-testid="cloud-code" className="font-mono text-[30px] font-semibold leading-tight tracking-[0.18em] text-accent num">
                {c.code}
              </div>
            </div>
            <div className="min-w-[180px] flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted" htmlFor="cloud-name">
                File name
              </label>
              <input
                id="cloud-name"
                data-testid="cloud-name"
                className="field mt-0.5 w-full"
                value={fileName}
                maxLength={80}
                onChange={(e) => setFileName(e.target.value)}
                onBlur={() => renameCloudFile(fileName)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <div className="mt-1 text-[11.5px]" data-testid="cloud-status">
                <CloudStatusText />
                {c.savedAt && c.status === 'saved' && <span className="text-muted"> · {when(c.savedAt)}</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyBtn text={c.code} label="Copy code" testid="cloud-copy-code" />
            <CopyBtn text={cloudLink(c.code)} label="Copy link" testid="cloud-copy-link" />
            <span className="flex-1" />
            <Btn tone="ghost" data-testid="cloud-leave" onClick={leaveCloud}>
              <LogOut size={14} /> Stop syncing
            </Btn>
          </div>
          <p className="mt-3 text-[12px] text-muted">
            Every change saves online automatically and shows up live for anyone else who has this file open. Share the code (or the link) with teammates — anyone with the
            code can view and edit. If two people move the same thing at the same moment, the last change wins.
          </p>
          {custom && (
            <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[12px] text-amber-600">
              Custom parts are stored in each browser, not online — teammates need the custom part bundle (Upload Custom Part → Export bundle) to see them.
            </div>
          )}
        </section>
      ) : (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Save this build online</h3>
          <div className="flex gap-2">
            <input
              data-testid="cloud-new-name"
              className="field flex-1"
              placeholder="Robot name, e.g. Worlds bot v2"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Btn
              tone="accent"
              data-testid="cloud-create"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await createCloudFile(name);
                setBusy(false);
              }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} Get a code
            </Btn>
          </div>
          <p className="mt-1 text-[11.5px] text-muted">You get a 6-digit code. Anyone with it can open and edit this robot; changes save online as you build.</p>
        </section>
      )}

      <section className="mt-5">
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Open with a code</h3>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void open(code);
          }}
        >
          <input
            data-testid="cloud-code-input"
            className="field w-40 text-center font-mono text-[16px] tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Btn tone={c.code ? 'default' : 'accent'} data-testid="cloud-open" disabled={code.length !== 6 || busy} onClick={() => void open(code)}>
            Open
          </Btn>
        </form>
        <p className="mt-1 text-[11.5px] text-muted">Opening a file replaces the build on screen. Codes are remembered in this browser, so you only type each one once.</p>
      </section>

      {c.remembered.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Your cloud files</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {c.remembered.map((r) => (
              <li key={r.code} data-testid="cloud-recent" className="flex items-center gap-3 px-3 py-1.5">
                <span className="font-mono text-[13px] tracking-[0.12em] num">{r.code}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.code === c.code ? (
                  <span className="text-[11.5px] font-medium text-accent">Open now</span>
                ) : (
                  <Btn tone="ghost" disabled={busy} onClick={() => void open(r.code)} data-testid="cloud-recent-open">
                    Open
                  </Btn>
                )}
                <Btn tone="ghost" aria-label={`Forget ${r.code}`} title="Forget this code on this browser (the file stays online)" onClick={() => forgetCode(r.code)}>
                  <Trash2 size={13} />
                </Btn>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.stash && !c.code && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-md bg-panel-2 px-3 py-2 text-[12px]" data-testid="cloud-stash">
          <span>Your own build from before you opened a cloud file ({c.stash.length} parts) is kept.</span>
          <span className="flex gap-1">
            <Btn onClick={restoreStash}>Bring it back</Btn>
            <Btn tone="ghost" onClick={dropStash}>
              Discard
            </Btn>
          </span>
        </div>
      )}
    </Modal>
  );
}
