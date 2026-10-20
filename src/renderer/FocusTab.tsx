// Focus tab: the active task and nothing else. Queued tasks appear only as a
// count, so the panel never tempts a switch. Finishing requires the typed
// ritual plus a self-grade; dropping requires a reason and an honest "why".

import { useEffect, useState } from 'react';
import { formatClock, formatHuman, modeLabel, phaseLabel } from '../shared/format';
import { banked } from '../shared/insights';
import { needsDeleteConfirm } from '../shared/tasks';
import { display } from '../shared/timer';
import { FINISH_PHRASE, isDropReason, isFinishPhrase } from '../shared/validation';
import type { DropKind, Grade, Snapshot, Task } from '../shared/types';
import { withEdit, type DraftState } from './draft';
import { QuickAdd } from './QueueTab';
import { Icon, Modal, PriorityDot, api, stateLabel, toneOf, useNow } from './ui';

export function FocusTab({ snap, draft }: { snap: Snapshot; draft: DraftState }) {
  const now = useNow();
  const [modal, setModal] = useState<'finish' | 'drop' | null>(null);
  const [summaryFor, setSummaryFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deletion = useDeleteFlow();
  const { tasks, settings } = snap.data;
  const active = tasks.find((t) => t.status === 'active');
  const queued = tasks.filter((t) => t.status === 'queued').length;
  const welcome = !settings.onboarded && <Welcome />;

  if (summaryFor) return <FinishSummary snap={snap} taskId={summaryFor} onDone={() => setSummaryFor(null)} />;

  if (!active) {
    return (
      <section className="stack">
        {welcome}
        <p className="lead">Nothing in focus. Add one task and define what finished looks like.</p>
        <QuickAdd settings={settings} />
      </section>
    );
  }

  const task = withEdit(active, draft);
  const d = display(active, now);
  const mode = active.timer.mode;
  const gapPending = snap.pendingGap !== null;
  const timer = async (action: 'start' | 'pause' | 'reset' | 'skip') => {
    const res = await api().command({ type: 'timer', action });
    setError(res.ok ? null : res.error);
  };
  const main = mode === 'stopwatch' ? formatClock(d.elapsed) : d.overtime > 0 ? `+${formatClock(d.overtime)}` : formatClock(d.remaining ?? 0);
  const est = active.estimateMs;
  const estLeft = est !== null ? est - d.workMs : 0;

  return (
    <section className="stack">
      {welcome}
      <h1 className="focus-name">
        <PriorityDot priority={task.priority} />
        {task.name}
      </h1>
      <div className="finish-card">
        <div className="finish-label">Finished looks like:</div>
        <div className="finish-text">{task.finishCondition}</div>
      </div>

      <div className={`timer-block tone-${toneOf(active, d)}`}>
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
            <div className={`bar-fill${d.progress >= 0.9 && d.progress < 1 ? ' late' : ''}`} style={{ width: `${d.progress * 100}%` }} />
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
      </dl>
      {est !== null && (
        <p className="muted small">
          Est. {formatHuman(est)} · {estLeft >= 0 ? `${formatHuman(estLeft)} left` : `${formatHuman(-estLeft)} over`}
        </p>
      )}

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

      {modal === 'finish' && (
        <FinishModal
          task={active}
          onClose={() => setModal(null)}
          onFinished={() => {
            setModal(null);
            setSummaryFor(active.id);
          }}
        />
      )}
      {modal === 'drop' && <DropModal task={active} onClose={() => setModal(null)} />}
      {deletion.modal}
    </section>
  );
}

function Welcome() {
  return (
    <div className="card welcome">
      <strong>Welcome to Monolith</strong>
      <ol>
        <li>Work on one task at a time. The rest wait in the queue.</li>
        <li>Before you start, write what "finished" looks like. It locks once the timer starts.</li>
        <li>To finish, you type: <em>{FINISH_PHRASE}</em>.</li>
      </ol>
      <button className="btn small" onClick={() => void api().command({ type: 'dismissWelcome' })}>Got it</button>
    </div>
  );
}

/** Shown for 5 seconds (or until clicked) after a finish, then the next task appears. */
function FinishSummary({ snap, taskId, onDone }: { snap: Snapshot; taskId: string; onDone: () => void }) {
  // Mount-only: the parent re-renders every 250 ms, which must not restart the 5 s.
  useEffect(() => {
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { journal, chain, tasks } = snap.data;
  const entry = [...journal].reverse().find((j) => j.taskId === taskId);
  const name = tasks.find((t) => t.id === taskId)?.name ?? 'Task';
  return (
    <button className="card summary" onClick={onDone} aria-label="Finish summary, click to continue">
      <span className="summary-title">{Icon.check} Finished: {name}</span>
      {entry && (
        <dl className="summary-grid">
          <div><dt>Time spent</dt><dd>{formatHuman(entry.trackedMs)}</dd></div>
          <div><dt>Estimate</dt><dd>{entry.estimateMs ? `${formatHuman(entry.estimateMs)} est.` : '-'}</dd></div>
          <div><dt>Started after</dt><dd>{formatHuman(entry.startLatencyMs)}</dd></div>
          <div><dt>Banked</dt><dd>{formatHuman(banked(journal))}</dd></div>
          <div><dt>Chain</dt><dd>{chain.current} <span className="muted small">best {chain.best}</span></dd></div>
        </dl>
      )}
      <span className="muted small">Click to continue</span>
    </button>
  );
}

const GRADES: [Grade, string][] = [['fully', 'Fully'], ['mostly', 'Mostly'], ['barely', 'Barely']];

function FinishModal({ task, onClose, onFinished }: { task: Task; onClose: () => void; onFinished: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [step, setStep] = useState<'phrase' | 'grade'>('phrase');
  const [error, setError] = useState<string | null>(null);
  const ready = isFinishPhrase(phrase);
  const submit = async (grade: Grade) => {
    const res = await api().command({ type: 'completeTask', taskId: task.id, phrase, grade });
    if (res.ok) onFinished();
    else setError(res.error);
  };
  return (
    <Modal title="Finish this task" onClose={onClose}>
      <div className="finish-card">
        <div className="finish-label">You said finished looks like:</div>
        <div className="finish-text">{task.finishCondition}</div>
      </div>
      {step === 'phrase' ? (
        <>
          <p>Is that exactly true now? If so, type: <strong>{FINISH_PHRASE}</strong></p>
          <input
            className="input"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && setStep('grade')}
            aria-label="Confirmation phrase"
            autoComplete="off"
          />
          <div className="modal-actions">
            <button className="btn finish" disabled={!ready} onClick={() => setStep('grade')}>Continue</button>
            <button className="btn ghost" onClick={onClose}>Not yet</button>
          </div>
        </>
      ) : (
        <>
          <p>How fully did you meet it? Be honest; only you see this.</p>
          <div className="modal-actions grades">
            {GRADES.map(([g, label]) => (
              <button key={g} className="btn" onClick={() => void submit(g)}>{label}</button>
            ))}
          </div>
        </>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

function DropModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<DropKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!kind) return;
    const res = await api().command({ type: 'dropTask', taskId: task.id, reason, kind });
    if (res.ok) onClose();
    else setError(res.error);
  };
  const option = (k: DropKind, label: string, hint: string) => (
    <label className="check radio">
      <input type="radio" name="drop-kind" checked={kind === k} onChange={() => setKind(k)} />
      <span>
        {label}
        <span className="muted small"> {hint}</span>
      </span>
    </label>
  );
  return (
    <Modal title="Drop this task?" onClose={onClose}>
      <p>The timer stops, tracked time is kept, and the task goes to the back of the queue.</p>
      {option('blocked', 'Blocked by something outside my control', '(no penalty)')}
      {option('lostFocus', 'I lost focus or interest', '(time counts as orphaned, chain resets)')}
      <textarea className="input" rows={2} placeholder="What happened?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn danger" disabled={!kind || !isDropReason(reason)} onClick={() => void submit()}>Drop task</button>
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
        Delete <strong>{task.name}</strong>? It has {formatHuman(task.workMs + task.breakMs)} of tracked time.{' '}
        {task.status === 'completed'
          ? 'Your stats keep its record.'
          : 'Its work time will count as orphaned in your stats.'}{' '}
        This cannot be undone.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn danger" onClick={() => void del()}>Delete</button>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
