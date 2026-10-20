// Settings tab. All edits go into the draft and are applied by
// "Save Changes & Collapse"; main re-registers shortcuts and reports failures.

import { CURRENCIES, type Currency, type Settings, type Snapshot } from '../shared/types';
import { isValidAccelerator, type Errors } from '../shared/validation';
import type { DraftState } from './draft';
import { TimerFields } from './TaskFields';
import { Field, api } from './ui';

interface Props {
  snap: Snapshot;
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  errors: Errors;
}

export function SettingsTab({ snap, draft, setDraft, errors }: Props) {
  const s = draft.settings ?? snap.settings;
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, settings: { ...(d.settings ?? snap.settings), ...patch } }));
  const err = (k: string) => errors[`settings.${k}`];
  const accelErr = (k: 'togglePanel' | 'startPause') =>
    err(`shortcuts.${k}`) ?? (isValidAccelerator(s.shortcuts[k]) ? undefined : 'Use a format like Ctrl+Alt+P.');
  const check = (key: keyof Settings, label: string, extra?: { disabled?: boolean; hint?: string }) => (
    <label className="check">
      <input type="checkbox" checked={s[key] as boolean} disabled={extra?.disabled} onChange={(e) => set({ [key]: e.target.checked } as Partial<Settings>)} />
      {label}
      {extra?.hint && <span className="muted small"> {extra.hint}</span>}
    </label>
  );

  return (
    <section className="stack">
      <h2 className="section-title">Default timer for new tasks</h2>
      <TimerFields value={s.defaultTimer} onChange={(defaultTimer) => set({ defaultTimer })} errors={errors} prefix="settings.defaultTimer" />

      <h2 className="section-title">Appearance</h2>
      <Field label={`Idle opacity: ${Math.round(s.idleOpacity * 100)}%`} error={err('idleOpacity')}>
        <input type="range" min={50} max={80} step={1} value={Math.round(s.idleOpacity * 100)} onChange={(e) => set({ idleOpacity: Number(e.target.value) / 100 })} />
      </Field>
      <div className="opacity-preview" aria-hidden="true">
        <div className="compact tone-running preview" style={{ background: `rgba(20, 22, 27, ${s.idleOpacity})` }}>
          <div className="compact-name">Preview</div>
          <div className="digits compact-digits">24:59</div>
        </div>
      </div>
      {check('showMoneyInCompact', 'Show task value on the compact card')}
      <Field label="Currency" error={err('currency')}>
        <select className="input" value={s.currency} onChange={(e) => set({ currency: e.target.value as Currency })}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>

      <h2 className="section-title">Alerts</h2>
      {check('soundEnabled', 'Sound')}
      {check('notificationsEnabled', 'Desktop notifications')}

      <h2 className="section-title">System</h2>
      {check('launchAtStartup', 'Launch at startup', snap.isPackaged ? undefined : { hint: '(applies to the installed app only)' })}
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

      <h2 className="section-title">Quit</h2>
      <p className="muted small">Monolith keeps running in the tray when collapsed. If a timer is running when you quit, the next launch asks whether the time away counts.</p>
      <button className="btn danger" onClick={() => api().quit()}>Quit Monolith</button>
    </section>
  );
}
