// Done tab: plain numbers about finishing, no streaks or badges. Totals,
// this week's started/finished/dropped, focused time, and the history list.

import { formatDate, formatHuman, formatMoney } from '../shared/format';
import { computeStats, moneyTotals } from '../shared/tasks';
import type { Snapshot } from '../shared/types';
import { useDeleteFlow } from './FocusTab';
import { api, useNow } from './ui';

export function DoneTab({ snap }: { snap: Snapshot }) {
  const now = useNow(1000);
  const deletion = useDeleteFlow();
  const cur = snap.settings.currency;
  const stats = computeStats({ version: 1, tasks: snap.tasks, settings: snap.settings, events: snap.events, windowPos: null }, now);
  const money = moneyTotals(snap.tasks);
  const done = snap.tasks.filter((t) => t.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  return (
    <section className="stack">
      <h2 className="section-title">This week</h2>
      <dl className="stat-grid">
        <div><dt>Started</dt><dd>{stats.started}</dd></div>
        <div><dt>Finished</dt><dd>{stats.finished}</dd></div>
        <div><dt>Dropped</dt><dd>{stats.dropped}</dd></div>
        <div><dt>Focused today</dt><dd>{formatHuman(stats.focusedToday)}</dd></div>
        <div><dt>Focused this week</dt><dd>{formatHuman(stats.focusedWeek)}</dd></div>
      </dl>

      <h2 className="section-title">Value of completed tasks</h2>
      <dl className="stat-grid">
        <div><dt>Total value</dt><dd>{formatMoney(money.value, cur)}</dd></div>
        <div><dt>Earned income</dt><dd>{formatMoney(money.earned, cur)}</dd></div>
        <div>
          <dt>est. per tracked hour</dt>
          <dd>{money.ratePerHour === null ? '-' : formatMoney(money.ratePerHour, cur)}</dd>
        </div>
      </dl>
      <p className="muted small">The rate is an estimate: value of completed tasks that have a value and tracked work, divided by that work time.</p>

      <h2 className="section-title">Completed ({done.length})</h2>
      <ul className="task-list">
        {done.length === 0 && <li className="muted small">Nothing finished yet. One task at a time.</li>}
        {done.map((t) => (
          <li key={t.id} className="task-row">
            <div className="task-row-main">
              <div className="task-row-text">
                <div className="task-row-name">{t.name}</div>
                <div className="muted small">
                  {formatHuman(t.workMs)}
                  {t.estimateMs !== null && ` of ${formatHuman(t.estimateMs)} est.`}
                  {t.value > 0 && ` · ${formatMoney(t.value, cur)}${t.valueIsEarned ? ' earned' : ''}`}
                  {t.completedAt !== null && ` · ${formatDate(t.completedAt)}`}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn small" onClick={() => void api().command({ type: 'reopenTask', taskId: t.id })}>Reopen</button>
                <button className="btn small ghost" onClick={() => void deletion.ask(t)}>Delete</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {deletion.modal}
    </section>
  );
}
