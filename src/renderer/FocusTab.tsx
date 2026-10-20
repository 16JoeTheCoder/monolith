// Focus tab: the active task and nothing else. Queued tasks appear only as a
// count, so the panel never tempts a switch. Finishing requires the typed
// ritual; dropping requires a reason.

import { useState } from 'react';
import { formatClock, formatHuman, modeLabel, phaseLabel } from '../shared/format';
import { needsDeleteConfirm } from '../shared/tasks';
import { display } from '../shared/timer';
import { FINISH_PHRASE, isDropReason, isFinishPhrase } from '../shared/validation';
import type { Snapshot, Task } from '../shared/types';
import { withEdit, type DraftState } from './draft';
import { QuickAdd } from './QueueTab';
import { Icon, Modal, api, stateLabel, toneOf, useNow } from './ui';

export function FocusTab({ snap, draft }: { snap: Snapshot; draft: DraftState }) {
  const now = useNow();
  const [modal, setModal] = useState<'finish' | 'drop' | null>(null);
  const deletion = useDeleteFlow();
  const [error, setError] = useState<string | null>(null);
  const active = snap.tasks.find((t) => t.status === 'active');
  const queued = snap.tasks.filter((t) => t.status === 'queued').length;

  if (!active) {
    return (
      <section className="stack">
        <p className="lead">Nothing in focus. Add one task and define what finished looks like.</p>
        <QuickAdd settings={snap.settings} />
      </section>
    );
  }

  const task = withEdit(active, draft);
  const d = display(active, now);
  const tone = toneOf(active, d);
  const mode = active.timer.mode;
  const gapPending = snap.pendingGap !== null;
  const timer = async (action: 'start' | 'pause' | 'reset' | 'skip') => {
    const res = await api().command({ type: 'timer', action });
    setError(res.ok ? null : res.error);
  };
  const main =
    mode === 'stopwatch' ? formatClock(d.elapsed) : d.overtime > 0 ? `+${formatClock(d.overtime)}` : formatClock(d.remaining ?? 0);

  return (
    <section className="stack">
      <h1 className="focus-name">{task.name}</h1>
      <div className="finish-card">
        <div className="finish-label">Finished looks like:</div>
        <div className="finish-text">{task.finishCondition}</div>
      </div>

      <div className={`timer-block tone-${tone}`}>
        <div className="timer-meta">
          <span className="badge">{stateLabel(d)}</span>
          <span className="muted">
            {modeLabel(mode)}
            {mode === 'pomodoro' && ` · ${d.phase === 'work' ? `Work ${d.cycle}/${active.timer.pomodoro.sessionsBeforeLongBreak}` : phaseLabel(d.phase)}`}
          </span>
        </div>
        <div className="digits focus-digits">{main}</div>
        {d.progress !== null && (
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.progress * 100)}>
            <div className="bar-fill" style={{ width: `${d.progress * 100}%` }} />
          </div>
        )}
        <div className="controls">
          {d.status === 'running' ? (
            <button className="btn" onClick={() => void timer('pause')} disabled={gapPending}>
              {Icon.pause} Pause
            </button>
          ) : (
            <button className="btn primary" onClick={() => void timer('start')} disabled={gapPending}>
              {Icon.play} {d.status === 'paused' ? 'Resume' : 'Start'}
            </button>
          )}
          <button className="btn" onClick={() => void timer('reset')} disabled={gapPending || (d.status === 'idle' && d.elapsed === 0)}>
            {Icon.reset} Reset
          </button>
          {mode === 'pomodoro' && (
            <button className="btn" onClick={() => void timer('skip')} disabled={gapPending}>
              {Icon.skip} Skip phase
            </button>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>

      <dl className="totals">
        <div><dt>Worked</dt><dd>{formatHuman(d.workMs)}</dd></div>
        {mode === 'pomodoro' && <div><dt>Breaks</dt><dd>{formatHuman(d.breakMs)}</dd></div>}
        {mode === 'pomodoro' && <div><dt>Pomodoros</dt><dd>{d.pomodorosCompleted}</dd></div>}
        {active.estimateMs !== null && <div><dt>Estimate</dt><dd>{formatHuman(active.estimateMs)}</dd></div>}
      </dl>

      <button className="btn finish wide" onClick={() => setModal('finish')}>
        {Icon.check} Finish task
      </button>
      <div className="row between">
        <span className="muted small">{queued} queued</span>
        {queued > 0 ? (
          <button className="link-btn" onClick={() => setModal('drop')}>Drop task</button>
        ) : (
          <button className="link-btn" onClick={() => void deletion.ask(active)} title="Nothing else is queued, so dropping is not possible">
            Delete task
          </button>
        )}
      </div>

      {modal === 'finish' && <FinishModal task={active} onClose={() => setModal(null)} />}
      {modal === 'drop' && <DropModal task={active} onClose={() => setModal(null)} />}
      {deletion.modal}
    </section>
  );
}

function FinishModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ready = isFinishPhrase(phrase);
  const submit = async () => {
    const res = await api().command({ type: 'completeTask', taskId: task.id, phrase });
    if (res.ok) onClose();
    else setError(res.error);
  };
  return (
    <Modal title="Finish this task" onClose={onClose}>
      <div className="finish-card">
        <div className="finish-label">You said finished looks like:</div>
        <div className="finish-text">{task.finishCondition}</div>
      </div>
      <p>Is that exactly true now? If so, type: <strong>{FINISH_PHRASE}</strong></p>
      <input
        className="input"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ready && void submit()}
        aria-label="Confirmation phrase"
        autoComplete="off"
      />
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn finish" disabled={!ready} onClick={() => void submit()}>Complete task</button>
        <button className="btn ghost" onClick={onClose}>Not yet</button>
      </div>
    </Modal>
  );
}

function DropModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const res = await api().command({ type: 'dropTask', taskId: task.id, reason });
    if (res.ok) onClose();
    else setError(res.error);
  };
  return (
    <Modal title="Drop this task?" onClose={onClose}>
      <p>The timer stops, tracked time is kept, and the task goes to the back of the queue. Why are you dropping it?</p>
      <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn danger" disabled={!isDropReason(reason)} onClick={() => void submit()}>Drop task</button>
        <button className="btn primary" onClick={onClose}>Keep going</button>
      </div>
    </Modal>
  );
}

/** Delete flow shared by Focus, Queue and Done: confirm in-app only when time has been tracked. */
export function useDeleteFlow() {
  const [target, setTarget] = useState<Task | null>(null);
  const ask = async (task: Task) => {
    if (needsDeleteConfirm(task, Date.now())) return setTarget(task);
    const res = await api().command({ type: 'deleteTask', taskId: task.id, confirmed: false });
    if (!res.ok && res.error === 'confirm-required') setTarget(task);
  };
  return { ask, modal: target ? <DeleteModal task={target} onClose={() => setTarget(null)} /> : null };
}

function DeleteModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const del = async () => {
    const res = await api().command({ type: 'deleteTask', taskId: task.id, confirmed: true });
    if (res.ok) onClose();
    else setError(res.error);
  };
  return (
    <Modal title="Delete task?" onClose={onClose}>
      <p>
        Delete <strong>{task.name}</strong>? It has {formatHuman(task.workMs + task.breakMs)} of tracked time, which will be lost. This
        cannot be undone.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn danger" onClick={() => void del()}>Delete</button>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
