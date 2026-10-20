// The expanded panel: header (drag grip, tabs, close), the active tab, and the
// "Save Changes & Collapse" footer. Owns the draft (unsaved edits to existing
// tasks and settings) and the two blocking modals: the time-gap prompt and the
// unsaved-changes prompt.

import { useEffect, useRef, useState } from 'react';
import { formatHuman, formatTimeOfDay } from '../shared/format';
import { validateSettings, validateTaskFields, type Errors } from '../shared/validation';
import type { Snapshot } from '../shared/types';
import { emptyDraft, isDirty, rebase, type DraftState } from './draft';
import { DoneTab } from './DoneTab';
import { FocusTab } from './FocusTab';
import { QueueTab } from './QueueTab';
import { SettingsTab } from './SettingsTab';
import { Icon, Modal, api, useDragClick } from './ui';

const TABS = ['Focus', 'Queue', 'Done', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export interface PanelProps {
  snap: Snapshot;
  onCollapse: () => void;
  closeRequest: number;
}

export function Panel({ snap, onCollapse, closeRequest }: PanelProps) {
  const [tab, setTab] = useState<Tab>('Focus');
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const drag = useDragClick();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const firstCloseRequest = useRef(closeRequest);

  // Rebase the draft whenever the snapshot changes underneath it.
  useEffect(() => setDraft((d) => rebase(d, snap.tasks, snap.settings)), [snap.tasks, snap.settings]);

  const dirty = isDirty(draft, snap.tasks, snap.settings);

  const requestClose = () => (dirty ? setConfirmClose(true) : onCollapse());

  useEffect(() => {
    // Main asked us to collapse (tray, shortcut): run the same flow as the close button.
    if (closeRequest !== firstCloseRequest.current) requestClose();
  }, [closeRequest]);

  async function save() {
    const d = rebase(draft, snap.tasks, snap.settings);
    const errs: Errors = {};
    for (const e of Object.values(d.edits)) for (const [k, v] of Object.entries(validateTaskFields(e))) errs[`${e.id}.${k}`] = v;
    if (d.settings) for (const [k, v] of Object.entries(validateSettings(d.settings))) errs[`settings.${k}`] = v;
    setErrors(errs);
    if (Object.keys(errs).length) {
      setSaveError('Fix the highlighted fields before saving.');
      setTab(Object.keys(errs).some((k) => k.startsWith('settings.')) ? 'Settings' : 'Queue');
      setConfirmClose(false);
      return;
    }
    setSaving(true);
    const res = await api().command({ type: 'saveDraft', draft: { tasks: Object.values(d.edits), settings: d.settings } });
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fields ?? {});
      setSaveError(res.error);
      setConfirmClose(false);
      return;
    }
    setDraft(emptyDraft());
    setSaveError(null);
    onCollapse();
  }

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    const next = (i + dir + TABS.length) % TABS.length;
    setTab(TABS[next]);
    tabRefs.current[next]?.focus();
  };

  const gap = snap.pendingGap;
  const blocking = gap !== null || confirmClose;

  return (
    <div
      className="panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !blocking && !e.defaultPrevented) requestClose();
      }}
    >
      <header className="panel-header">
        <div className="grip" {...drag} title="Drag to move" aria-label="Drag to move">
          {Icon.grip}
        </div>
        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t, i) => (
            <button
              key={t}
              ref={(el) => (tabRefs.current[i] = el)}
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`pane-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className={`tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={requestClose} aria-label="Close panel" title="Close (Esc)">
          {Icon.close}
        </button>
      </header>

      <main className="panel-body" role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Focus' && <FocusTab snap={snap} draft={draft} />}
        {tab === 'Queue' && <QueueTab snap={snap} draft={draft} setDraft={setDraft} errors={errors} />}
        {tab === 'Done' && <DoneTab snap={snap} />}
        {tab === 'Settings' && <SettingsTab snap={snap} draft={draft} setDraft={setDraft} errors={errors} />}
      </main>

      <footer className="panel-footer">
        {saveError && <div className="form-error" role="alert">{saveError}</div>}
        <button className="btn primary wide" onClick={() => void save()} disabled={saving}>
          Save Changes &amp; Collapse
        </button>
      </footer>

      {gap && <GapModal from={gap.from} to={gap.to} />}
      {!gap && confirmClose && (
        <Modal title="Unsaved changes" onClose={() => setConfirmClose(false)}>
          <p>You have edits that are not saved yet.</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => void save()}>Save</button>
            <button
              className="btn"
              onClick={() => {
                setDraft(emptyDraft());
                setErrors({});
                setSaveError(null);
                setConfirmClose(false);
                onCollapse();
              }}
            >
              Discard
            </button>
            <button className="btn ghost" onClick={() => setConfirmClose(false)}>Keep editing</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GapModal({ from, to }: { from: number; to: number }) {
  const [busy, setBusy] = useState(false);
  const answer = async (count: boolean) => {
    setBusy(true);
    await api().command({ type: 'answerGap', count });
    setBusy(false);
  };
  return (
    <Modal title="Time gap detected">
      <p>
        Your PC was off/asleep from {formatTimeOfDay(from)} to {formatTimeOfDay(to)} ({formatHuman(to - from)}). Count that time, or go
        back to the last recorded time?
      </p>
      <p className="muted small">Either way the timer stays paused until you press Resume.</p>
      <div className="modal-actions">
        <button className="btn" disabled={busy} onClick={() => void answer(true)}>Count it</button>
        <button className="btn primary" disabled={busy} onClick={() => void answer(false)}>Go back</button>
      </div>
    </Modal>
  );
}
