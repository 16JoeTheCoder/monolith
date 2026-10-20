// Draft helpers for the expanded panel. Edits to existing tasks and settings
// stay local until "Save Changes & Collapse"; these functions decide what is
// dirty and keep the draft consistent when the snapshot changes underneath it.

import type { Settings, Task, TaskEdit } from '../shared/types';

export interface DraftState {
  edits: Record<string, TaskEdit>;
  settings: Settings | null;
}

export const emptyDraft = (): DraftState => ({ edits: {}, settings: null });

export function toEdit(t: Task): TaskEdit {
  return {
    id: t.id,
    name: t.name,
    finishCondition: t.finishCondition,
    priority: t.priority,
    estimateMs: t.estimateMs,
    timer: t.timer,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Rebase by task id: drop edits for tasks that vanished or completed, or that now match the snapshot. */
export function rebase(draft: DraftState, tasks: Task[], settings: Settings): DraftState {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const edits: Record<string, TaskEdit> = {};
  for (const [id, e] of Object.entries(draft.edits)) {
    const t = byId.get(id);
    if (t && t.status !== 'completed' && !same(e, toEdit(t))) edits[id] = e;
  }
  const s = draft.settings && !same(draft.settings, settings) ? draft.settings : null;
  const changed = Object.keys(edits).length !== Object.keys(draft.edits).length || s !== draft.settings;
  return changed ? { edits, settings: s } : draft;
}

export function isDirty(draft: DraftState, tasks: Task[], settings: Settings): boolean {
  const r = rebase(draft, tasks, settings);
  return Object.keys(r.edits).length > 0 || r.settings !== null;
}

/** The task as the user currently sees it: snapshot plus any unsaved edit. */
export function withEdit(t: Task, draft: DraftState): Task {
  const e = draft.edits[t.id];
  return e ? { ...t, ...e } : t;
}
