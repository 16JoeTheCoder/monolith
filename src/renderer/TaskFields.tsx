// Form fields for a task (used by "Add task" and the inline editor) and for a
// timer config (also used by Settings). Only the selected mode's fields show.

import type { Errors } from '../shared/validation';
import { hmsToMs, splitHms } from '../shared/validation';
import type { Priority, TaskEdit, TimerConfig, TimerMode } from '../shared/types';
import { Field } from './ui';

export type TaskValues = Omit<TaskEdit, 'id'>;
const MIN = 60_000;

/** Number input that lets the field be empty while typing (NaN fails validation). */
export function NumInput(props: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: string; disabled?: boolean; label?: string }) {
  return (
    <input
      className="input"
      type="number"
      step={props.step ?? 'any'}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      aria-label={props.label}
      value={Number.isFinite(props.value) ? props.value : ''}
      onChange={(e) => props.onChange(e.target.value === '' ? NaN : Number(e.target.value))}
    />
  );
}

export function TimerFields(props: { value: TimerConfig; onChange: (t: TimerConfig) => void; errors: Errors; prefix: string; disabled?: boolean }) {
  const { value: t, onChange, errors, prefix, disabled } = props;
  const err = (k: string) => errors[`${prefix}.${k}`];
  const hms = splitHms(t.countdown.durationMs);
  const setHms = (patch: Partial<typeof hms>) => {
    const n = { ...hms, ...patch };
    onChange({ ...t, countdown: { ...t.countdown, durationMs: hmsToMs(n.h, n.m, n.s) } });
  };
  const setPomo = (patch: Partial<TimerConfig['pomodoro']>) => onChange({ ...t, pomodoro: { ...t.pomodoro, ...patch } });
  const modes: TimerMode[] = ['countdown', 'pomodoro', 'stopwatch'];

  return (
    <fieldset className="timer-fields" disabled={disabled}>
      <div className="segmented" role="radiogroup" aria-label="Timer mode">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={t.mode === m}
            className={t.mode === m ? 'seg active' : 'seg'}
            onClick={() => onChange({ ...t, mode: m })}
          >
            {m === 'countdown' ? 'Countdown' : m === 'pomodoro' ? 'Pomodoro' : 'Stopwatch'}
          </button>
        ))}
      </div>
      {t.mode === 'countdown' && (
        <>
          <div className="grid3">
            <Field label="Hours"><NumInput value={hms.h} min={0} max={24} step="1" onChange={(h) => setHms({ h })} /></Field>
            <Field label="Minutes"><NumInput value={hms.m} min={0} max={59} step="1" onChange={(m) => setHms({ m })} /></Field>
            <Field label="Seconds"><NumInput value={hms.s} min={0} max={59} step="1" onChange={(s) => setHms({ s })} /></Field>
          </div>
          {err('countdown') && <div className="field-error">{err('countdown')}</div>}
          <Field label="At zero">
            <select className="input" value={t.countdown.onExpire} onChange={(e) => onChange({ ...t, countdown: { ...t.countdown, onExpire: e.target.value as 'stop' | 'continue' } })}>
              <option value="stop">Stop</option>
              <option value="continue">Keep counting (overtime)</option>
            </select>
          </Field>
        </>
      )}
      {t.mode === 'pomodoro' && (
        <>
          <div className="grid3">
            <Field label="Work (min)" error={err('workMs')}><NumInput value={t.pomodoro.workMs / MIN} min={1} max={180} onChange={(v) => setPomo({ workMs: v * MIN })} /></Field>
            <Field label="Short break" error={err('shortBreakMs')}><NumInput value={t.pomodoro.shortBreakMs / MIN} min={1} max={60} onChange={(v) => setPomo({ shortBreakMs: v * MIN })} /></Field>
            <Field label="Long break" error={err('longBreakMs')}><NumInput value={t.pomodoro.longBreakMs / MIN} min={1} max={60} onChange={(v) => setPomo({ longBreakMs: v * MIN })} /></Field>
          </div>
          <Field label="Long break every N work sessions" error={err('sessions')}>
            <NumInput value={t.pomodoro.sessionsBeforeLongBreak} min={1} max={12} step="1" onChange={(v) => setPomo({ sessionsBeforeLongBreak: v })} />
          </Field>
          <label className="check"><input type="checkbox" checked={t.pomodoro.autoStartBreaks} onChange={(e) => setPomo({ autoStartBreaks: e.target.checked })} /> Auto-start breaks</label>
          <label className="check"><input type="checkbox" checked={t.pomodoro.autoStartWork} onChange={(e) => setPomo({ autoStartWork: e.target.checked })} /> Auto-start work after breaks</label>
        </>
      )}
      {t.mode === 'stopwatch' && <p className="muted small">Counts up. Set an estimate under More to see progress.</p>}
    </fieldset>
  );
}

export function TaskFields(props: {
  value: TaskValues;
  onChange: (patch: Partial<TaskValues>) => void;
  errors: Errors;
  prefix: string;
  finishLocked?: boolean;
  timerLocked?: boolean;
}) {
  const { value: v, onChange, errors, prefix, finishLocked, timerLocked } = props;
  const err = (k: string) => errors[`${prefix}${k}`];
  return (
    <div className="stack tight">
      <Field label="Task name" error={err('name')}>
        <input className="input" value={v.name} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      {finishLocked ? (
        <div className="finish-card">
          <div className="finish-label">Finished looks like:</div>
          <div className="finish-text">{v.finishCondition}</div>
          <div className="muted small">Locked because the timer has started. Finish it or drop it; do not move the goalposts.</div>
        </div>
      ) : (
        <Field label="Finished looks like" error={err('finishCondition')} hint="Describe exactly what done means. Locked once the timer starts.">
          <textarea className="input" rows={2} value={v.finishCondition} onChange={(e) => onChange({ finishCondition: e.target.value })} />
        </Field>
      )}
      <Field label="Value" error={err('value')} hint="Zero is fine.">
        <NumInput value={v.value} min={0} onChange={(value) => onChange({ value })} />
      </Field>
      {timerLocked && <p className="muted small">Pause to change timer settings.</p>}
      <TimerFields value={v.timer} onChange={(timer) => onChange({ timer })} errors={errors} prefix={`${prefix}timer`} disabled={timerLocked} />
      <details className="more">
        <summary>More</summary>
        <div className="stack tight">
          <Field label="Notes" error={err('notes')}>
            <textarea className="input" rows={3} maxLength={2000} value={v.notes} onChange={(e) => onChange({ notes: e.target.value })} />
          </Field>
          <div className="grid2">
            <Field label="Priority" error={err('priority')}>
              <select className="input" value={v.priority} onChange={(e) => onChange({ priority: e.target.value as Priority })}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Deadline" error={err('deadline')}>
              <input
                className="input"
                type="date"
                value={v.deadline ? v.deadline.slice(0, 10) : ''}
                onChange={(e) => onChange({ deadline: e.target.value ? new Date(`${e.target.value}T23:59:00`).toISOString() : null })}
              />
            </Field>
          </div>
          <Field label="Estimate (minutes)" error={err('estimateMs')}>
            <NumInput value={v.estimateMs === null ? NaN : v.estimateMs / MIN} min={1} onChange={(m) => onChange({ estimateMs: Number.isFinite(m) ? m * MIN : null })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={v.valueIsEarned} onChange={(e) => onChange({ valueIsEarned: e.target.checked })} /> Value is earned income
          </label>
        </div>
      </details>
    </div>
  );
}
