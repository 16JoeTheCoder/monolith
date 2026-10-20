// Queue tab: add tasks, see what is in focus and what is up next, reorder the
// waiting tasks, edit (into the draft) and delete. There is deliberately no
// "start this one" action: the only way to change focus is finish or drop.

import { useState } from 'react';
import { formatHuman, formatMoney } from '../shared/format';
import { isLocked } from '../shared/tasks';
import type { Errors } from '../shared/validation';
import type { Settings, Snapshot, Task } from '../shared/types';
import { toEdit, withEdit, type DraftState } from './draft';
import { useDeleteFlow } from './FocusTab';
import { TaskFields, type TaskValues } from './TaskFields';
import { Field, Icon, api } from './ui';

interface Props {
  snap: Snapshot;
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  errors: Errors;
}

const blank = (s: Settings): TaskValues => ({
  name: '',
  notes: '',
  finishCondition: '',
  priority: 'none',
  value: 0,
  valueIsEarned: false,
  deadline: null,
  estimateMs: null,
  timer: structuredClone(s.defaultTimer),
});

export function QueueTab({ snap, draft, setDraft, errors }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const deletion = useDeleteFlow();
  const active = snap.tasks.find((t) => t.status === 'active');
  const queued = snap.tasks.filter((t) => t.status === 'queued');

  const patch = (task: Task, p: Partial<TaskValues>) =>
    setDraft((d) => ({ ...d, edits: { ...d.edits, [task.id]: { ...(d.edits[task.id] ?? toEdit(task)), ...p } } }));
  const move = (id: string, direction: 'up' | 'down') => void api().command({ type: 'moveTask', taskId: id, direction });

  const row = (task: Task, index: number | null) => {
    const view = withEdit(task, draft);
    const open = editing === task.id;
    const hasErr = Object.keys(errors).some((k) => k.startsWith(`${task.id}.`));
    return (
      <li key={task.id} className={`task-row${index === null ? ' pinned' : ''}${hasErr ? ' has-error' : ''}`}>
        <div className="task-row-main">
          <div className="task-row-text">
            <div className="task-row-name">{view.name}{draft.edits[task.id] && <span className="dirty-dot" title="Unsaved edits" />}</div>
            <div className="muted small">
              {index === null ? 'In focus' : `#${index + 1}`}
              {task.workMs > 0 && ` · ${formatHuman(task.workMs)} tracked`}
              {task.droppedCount > 0 && ` · dropped ${task.droppedCount}x`}
              {view.value > 0 && ` · ${formatMoney(view.value, snap.settings.currency)}`}
            </div>
          </div>
          <div className="row-actions">
            {index !== null && (
              <>
                <button className="icon-btn" aria-label={`Move ${task.name} up`} disabled={index === 0} onClick={() => move(task.id, 'up')}>{Icon.up}</button>
                <button className="icon-btn" aria-label={`Move ${task.name} down`} disabled={index === queued.length - 1} onClick={() => move(task.id, 'down')}>{Icon.down}</button>
              </>
            )}
            <button className={`icon-btn${open ? ' on' : ''}`} aria-label={`Edit ${task.name}`} aria-expanded={open} onClick={() => setEditing(open ? null : task.id)}>{Icon.edit}</button>
            <button className="icon-btn" aria-label={`Delete ${task.name}`} onClick={() => void deletion.ask(task)}>{Icon.trash}</button>
          </div>
        </div>
        {(open || hasErr) && (
          <div className="editor">
            <TaskFields
              value={toEdit(view)}
              onChange={(p) => patch(task, p)}
              errors={errors}
              prefix={`${task.id}.`}
              finishLocked={isLocked(task)}
              timerLocked={task.runtime.status === 'running'}
            />
            <p className="muted small">Edits are saved with "Save Changes &amp; Collapse".</p>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="stack">
      <AddTaskForm settings={snap.settings} />
      <h2 className="section-title">In focus</h2>
      <ul className="task-list">{active ? row(active, null) : <li className="muted small">Nothing in focus.</li>}</ul>
      <h2 className="section-title">Up next</h2>
      <ul className="task-list">{queued.length ? queued.map((t, i) => row(t, i)) : <li className="muted small">Queue is empty.</li>}</ul>
      {deletion.modal}
    </section>
  );
}

function AddTaskForm({ settings }: { settings: Settings }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<TaskValues>(() => blank(settings));
  const [errors, setErrors] = useState<Errors>({});
  const submit = async () => {
    const res = await api().command({ type: 'addTask', input: v });
    if (res.ok) {
      setV(blank(settings));
      setErrors({});
      setOpen(false);
    } else setErrors(res.fields ?? { name: res.error });
  };
  if (!open) {
    return <button className="btn wide" onClick={() => setOpen(true)}>+ Add task</button>;
  }
  return (
    <form className="card stack" onSubmit={(e) => (e.preventDefault(), void submit())}>
      <h2 className="section-title">Add task</h2>
      <TaskFields value={v} onChange={(p) => setV((x) => ({ ...x, ...p }))} errors={errors} prefix="" />
      <div className="row">
        <button className="btn primary" type="submit">Add to queue</button>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** The Focus tab's empty state: name + finish condition, added and activated at once. */
export function QuickAdd({ settings }: { settings: Settings }) {
  const [name, setName] = useState('');
  const [finish, setFinish] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const submit = async () => {
    const res = await api().command({ type: 'addTask', input: { ...blank(settings), name, finishCondition: finish } });
    if (!res.ok) setErrors(res.fields ?? { name: res.error });
  };
  return (
    <form className="card stack" onSubmit={(e) => (e.preventDefault(), void submit())}>
      <Field label="Task name" error={errors.name}>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Finished looks like" error={errors.finishCondition} hint="At least 8 characters. Be specific.">
        <textarea className="input" rows={2} value={finish} onChange={(e) => setFinish(e.target.value)} />
      </Field>
      <button className="btn primary" type="submit">Focus on this</button>
    </form>
  );
}
