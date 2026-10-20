// Settings tab. All edits go into the draft and are applied by
// "Save Changes & Collapse"; main re-registers shortcuts and reports failures.
// Exceptions that act immediately: Quit and "Reset all data" (behind a confirm).

import { useState } from 'react';
import { defaultAppearance } from '../shared/tasks';
import { THEMES, type Appearance, type Settings, type Snapshot, type Theme } from '../shared/types';
import { APPEARANCE_LIMITS, isValidAccelerator, type Errors } from '../shared/validation';
import { CompactCard } from './Compact';
import type { DraftState } from './draft';
import { TimerFields } from './TaskFields';
import { Field, Modal, api, useNow } from './ui';

interface Props {
  snap: Snapshot;
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  errors: Errors;
}

const SIZE_LABELS: [keyof Appearance, string][] = [
  ['statusPx', 'Status row'],
  ['titlePx', 'Task title'],
  ['digitsPx', 'Timer digits'],
  ['barPx', 'Progress bar'],
];

const sample = (s: Settings) => ({
  id: 'preview',
  name: 'Write the project proposal',
  finishCondition: 'preview',
  priority: 'medium' as const,
  estimateMs: null,
  status: 'active' as const,
  timer: s.defaultTimer,
  runtime: { status: 'paused' as const, phase: 'work' as const, phaseElapsedMs: 0.62 * s.defaultTimer.countdown.durationMs, sliceStartedAt: null, cycleSessions: 1, expiredNotified: false },
  workMs: 0,
  breakMs: 0,
  pomodorosCompleted: 0,
  sessions: [],
  createdAt: 0,
  activatedAt: 0,
  startedAt: 0,
  startLatencyMs: 0,
  completedAt: null,
  droppedCount: 0,
  lostFocusDrops: 0,
});

export function SettingsTab({ snap, draft, setDraft, errors }: Props) {
  const now = useNow();
  const [confirmReset, setConfirmReset] = useState(false);
  const saved = snap.data.settings;
  const s = draft.settings ?? saved;
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, settings: { ...(d.settings ?? saved), ...patch } }));
  const setSize = (k: keyof Appearance, v: number) => set({ appearance: { ...s.appearance, [k]: v } });
  const err = (k: string) => errors[`settings.${k}`];
  const accelErr = (k: 'togglePanel' | 'startPause') =>
    err(`shortcuts.${k}`) ?? (isValidAccelerator(s.shortcuts[k]) ? undefined : 'Use a format like Ctrl+Alt+P.');
  const check = (key: keyof Settings, label: string, hint?: string) => (
    <label className="check">
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.target.checked } as Partial<Settings>)} />
      {label}
      {hint && <span className="muted small"> {hint}</span>}
    </label>
  );
  const previewTask = snap.data.tasks.find((t) => t.status === 'active') ?? sample(s);

  return (
    <section className="stack">
      <h2 className="section-title">Appearance</h2>
      <div className="preview-stage" aria-label="Preview">
        <CompactCard task={previewTask} settings={s} now={now} className="preview" />
      </div>
      <div className="grid2">
        <Field label="Theme" error={err('theme')}>
          <select className="input" value={s.theme} onChange={(e) => set({ theme: e.target.value as Theme })}>
            {THEMES.map((t) => (
              <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span className="field-label">Accent</span>
          <div className="row">
            <input type="color" className="swatch" aria-label="Custom accent colour" value={s.accent ?? '#e8eef7'} onChange={(e) => set({ accent: e.target.value })} />
            {s.accent && <button type="button" className="link-btn" onClick={() => set({ accent: null })}>Use theme colour</button>}
          </div>
        </div>
      </div>
      <Slider label="Card opacity" value={Math.round(s.idleOpacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ idleOpacity: v / 100 })} error={err('idleOpacity')} />
      {SIZE_LABELS.map(([k, label]) => (
        <Slider key={k} label={label} value={s.appearance[k]} min={APPEARANCE_LIMITS[k][0]} max={APPEARANCE_LIMITS[k][1]} unit="px" onChange={(v) => setSize(k, v)} />
      ))}
      <div>
        <button type="button" className="btn small" onClick={() => set({ appearance: defaultAppearance(), idleOpacity: 0.65, theme: 'graphite', accent: null })}>
          Reset appearance
        </button>
      </div>

      <h2 className="section-title">Default timer for new tasks</h2>
      <TimerFields value={s.defaultTimer} onChange={(defaultTimer) => set({ defaultTimer })} errors={errors} prefix="settings.defaultTimer" />

      <h2 className="section-title">Alerts</h2>
      {check('soundEnabled', 'Sound')}
      {check('notificationsEnabled', 'Desktop notifications')}

      <h2 className="section-title">System</h2>
      {check('launchAtStartup', 'Launch at startup', snap.isPackaged ? undefined : '(installed app only)')}
      {check('shortcutsEnabled', 'Global shortcuts')}
      <div className="grid2">
        <Field label="Toggle panel" error={s.shortcutsEnabled ? accelErr('togglePanel') : undefined}>
          <input className="input" value={s.shortcuts.togglePanel} disabled={!s.shortcutsEnabled} onChange={(e) => set({ shortcuts: { ...s.shortcuts, togglePanel: e.target.value } })} />
        </Field>
        <Field label="Start / pause" error={s.shortcutsEnabled ? accelErr('startPause') : undefined}>
          <input className="input" value={s.shortcuts.startPause} disabled={!s.shortcutsEnabled} onChange={(e) => set({ shortcuts: { ...s.shortcuts, startPause: e.target.value } })} />
        </Field>
      </div>
      {snap.shortcutError && <div className="form-error" role="alert">{snap.shortcutError}</div>}

      <h2 className="section-title">About</h2>
      <p className="muted small">
        Monolith {snap.version}. One task at a time, finished. Monolith keeps running in the tray when collapsed; if a timer is running when you
        quit, the next launch asks whether the time away counts.
      </p>
      <div className="row">
        <button className="btn danger" onClick={() => api().quit()}>Quit Monolith</button>
        <button className="btn ghost" onClick={() => setConfirmReset(true)}>Reset all data</button>
      </div>

      {confirmReset && (
        <Modal title="Reset all data?" onClose={() => setConfirmReset(false)}>
          <p>This deletes every task, your history, stats and settings. It cannot be undone.</p>
          <div className="modal-actions">
            <button
              className="btn danger"
              onClick={() => {
                setDraft({ edits: {}, settings: null });
                setConfirmReset(false);
                void api().command({ type: 'resetAll' });
              }}
            >
              Reset everything
            </button>
            <button className="btn primary" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void; error?: string }) {
  return (
    <Field label={props.label} error={props.error}>
      <div className="slider">
        <input type="range" min={props.min} max={props.max} step={1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
        <output className="num">
          {props.value}
          {props.unit}
        </output>
      </div>
    </Field>
  );
}
