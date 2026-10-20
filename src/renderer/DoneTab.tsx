// Done tab, in a fixed order: the three header numbers (banked, orphaned,
// chain) and this week's line, the Focus Index, a few plain details, then the
// history list. Everything is computed from the daily record and journal, so
// deleting a task never rewrites these numbers.

import { formatDate, formatHuman } from '../shared/format';
import {
  banked, calibration, calibrationText, focusIndex, heatmap, lifetimeAverage, orphaned, startLatencyWeek, weekSummary,
} from '../shared/insights';
import type { Snapshot } from '../shared/types';
import { useDeleteFlow } from './FocusTab';
import { api, useNow } from './ui';

const GRADE_LABEL = { fully: 'Fully', mostly: 'Mostly', barely: 'Barely' } as const;

const calibrating = (left: number) => `Finish ${Math.max(1, left)} more ${left === 1 ? 'task' : 'tasks'} with an estimate to calibrate.`;

export function DoneTab({ snap }: { snap: Snapshot }) {
  const now = useNow(1000);
  const deletion = useDeleteFlow();
  const data = snap.data;
  const week = weekSummary(data, now);
  const fi = focusIndex(data, now);
  const life = lifetimeAverage(data, now);
  const cal = calibration(data.journal);
  const latency = startLatencyWeek(data.tasks, now);
  const heat = heatmap(data, now);
  const grades = new Map(data.journal.map((j) => [j.taskId, j.grade]));
  const done = data.tasks.filter((t) => t.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  return (
    <section className="stack">
      <dl className="stat-grid three">
        <div title="Tracked work of every task you finished"><dt>Banked</dt><dd>{formatHuman(banked(data.journal))}</dd></div>
        <div title="Work on tasks dropped for lost focus, plus deleted unfinished work"><dt>Orphaned</dt><dd>{formatHuman(orphaned(data))}</dd></div>
        <div title="Finishes of 10+ minutes in a row without a lost-focus drop"><dt>Chain</dt><dd>{data.chain.current} <span className="muted small">best {data.chain.best}</span></dd></div>
      </dl>
      <p className="muted small">
        Finished {week.finished} of {week.started} started this week - {week.fully} fully
      </p>

      <div className="card index">
        {fi.ready ? (
          <>
            <div className="index-head">
              <span className="index-score">{fi.score}</span>
              <span className="muted small">Focus Index · {fi.confidence} confidence</span>
            </div>
            {fi.parts.map((p) => (
              <div key={p.key} className="index-part">
                <span className="small">{p.label}</span>
                <span className="index-bar"><span style={{ width: `${Math.round(p.value * 100)}%` }} /></span>
                <span className="muted small num">{Math.round(p.value * 100)}</span>
              </div>
            ))}
            <p className="small">{fi.sentence}</p>
          </>
        ) : (
          <p className="muted small">
            Focus Index · Calibrating: {fi.tasks}/3 tasks, {fi.days}/3 days
          </p>
        )}
      </div>

      <dl className="details">
        <div><dt>Focus per day, lifetime</dt><dd>{life ? `${formatHuman(life.perDay)} · last 7 days ${formatHuman(life.last7)}` : '-'}</dd></div>
        <div><dt>Start latency this week</dt><dd>{latency === null ? '-' : formatHuman(latency)}</dd></div>
        <div><dt>Estimates</dt><dd>{cal ? calibrationText(cal) : calibrating(3 - data.journal.filter((j) => j.estimateMs).length)}</dd></div>
      </dl>

      <div className="heatmap" role="img" aria-label="Focus per day, last 20 weeks">
        {heat.weeks.flat().map((c) => (
          <span key={c.key} className={`cell l${c.level}${c.future ? ' future' : ''}`} title={`${formatDate(c.date)}: ${formatHuman(c.ms)}`} />
        ))}
      </div>
      <p className="muted small">
        Longest stretch {formatHuman(data.bests.longestStretchMs)} · Best day {formatHuman(heat.bestDayMs)} · Best chain {data.chain.best}
      </p>

      <h2 className="section-title">Completed ({done.length})</h2>
      <ul className="task-list">
        {done.length === 0 && <li className="muted small">Nothing finished yet. One task at a time.</li>}
        {done.map((t) => {
          const g = grades.get(t.id);
          return (
            <li key={t.id} className="task-row">
              <div className="task-row-main">
                <div className="task-row-text">
                  <div className="task-row-name">{t.name}</div>
                  <div className="muted small">
                    {formatHuman(t.workMs)}
                    {t.estimateMs !== null && ` of ${formatHuman(t.estimateMs)} est.`}
                    {g && ` · ${GRADE_LABEL[g]}`}
                    {t.completedAt !== null && ` · ${formatDate(t.completedAt)}`}
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn small" onClick={() => void api().command({ type: 'reopenTask', taskId: t.id })}>Reopen</button>
                  <button className="btn small ghost" onClick={() => void deletion.ask(t)}>Delete</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {deletion.modal}
    </section>
  );
}
