import { useState } from 'react';
import { Check, Cloud, Copy, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCadStore } from '../store/useCadStore';
import { deleteProject, duplicateProject, newProject, openProject, renameProject, useProjectStore, type ProjectMeta } from '../services/projects';
import { Btn, Modal } from './ui';
import { viewportBus } from '../viewport/Viewport';

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

function Row({ p, active }: { p: ProjectMeta; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [confirm, setConfirm] = useState(false);
  const close = () => useCadStore.getState().set({ modal: null });
  return (
    <li data-testid="project-row" data-id={p.id} data-active={active ? '1' : '0'} className={`flex items-center gap-3 px-3 py-2 ${active ? 'bg-accent-soft' : ''}`}>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              renameProject(p.id, name);
              setEditing(false);
            }}
          >
            <input data-testid="project-rename-input" autoFocus className="field flex-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <Btn type="submit" aria-label="Save name">
              <Check size={14} />
            </Btn>
            <Btn tone="ghost" aria-label="Cancel" onClick={() => setEditing(false)}>
              <X size={14} />
            </Btn>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="truncate font-medium" data-testid="project-name">
                {p.name}
              </span>
              {active && <span className="rounded bg-accent px-1.5 text-[10.5px] font-semibold text-white">open</span>}
              {p.code && (
                <span className="inline-flex items-center gap-1 rounded bg-panel-2 px-1.5 font-mono text-[10.5px] text-muted num" title="Linked to this cloud file — changes save online">
                  <Cloud size={11} /> {p.code}
                </span>
              )}
            </div>
            <div className="text-[11.5px] text-muted num">
              {p.parts} {p.parts === 1 ? 'part' : 'parts'} · {when(p.updatedAt)}
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex items-center gap-0.5">
          {!active && (
            <Btn
              data-testid="project-open"
              onClick={async () => {
                close();
                await openProject(p.id);
                setTimeout(() => viewportBus.fit(), 300);
              }}
            >
              <FolderOpen size={14} /> Open
            </Btn>
          )}
          <Btn tone="ghost" aria-label={`Rename ${p.name}`} title="Rename" data-testid="project-rename" onClick={() => (setName(p.name), setEditing(true))}>
            <Pencil size={13} />
          </Btn>
          <Btn tone="ghost" aria-label={`Duplicate ${p.name}`} title="Duplicate" data-testid="project-duplicate" onClick={() => void duplicateProject(p.id)}>
            <Copy size={13} />
          </Btn>
          {confirm ? (
            <Btn tone="danger" data-testid="project-delete-confirm" onClick={() => void deleteProject(p.id)}>
              Delete?
            </Btn>
          ) : (
            <Btn tone="ghost" aria-label={`Delete ${p.name}`} title={p.code ? 'Delete from this browser (the cloud file stays online)' : 'Delete'} data-testid="project-delete" onClick={() => setConfirm(true)}>
              <Trash2 size={13} />
            </Btn>
          )}
        </div>
      )}
    </li>
  );
}

export function ProjectsModal() {
  const { list, activeId } = useProjectStore();
  const [name, setName] = useState('');
  const close = () => useCadStore.getState().set({ modal: null });
  return (
    <Modal testid="projects-modal" title="Projects" onClose={close}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          close();
          await newProject(name);
        }}
      >
        <input data-testid="project-new-name" className="field flex-1" placeholder="New robot name, e.g. Intake prototype" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Btn tone="accent" type="submit" data-testid="project-new">
          <Plus size={14} /> New project
        </Btn>
      </form>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line" data-testid="project-list">
        {list.map((p) => (
          <Row key={p.id} p={p} active={p.id === activeId} />
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-muted">
        Projects are saved in this browser and autosave as you build. A project with a cloud code also saves online — open the code on another computer to get it there.
      </p>
    </Modal>
  );
}
