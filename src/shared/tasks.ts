// Task and queue logic: the single-focus rules as pure functions over AppData.
// Main runs every command through here, then persists. Each mutation ends with
// normalize(), which restores the invariant: the first non-completed task is the
// one and only active task, everything else not completed is queued.

import { advance, closeSlice, idleRuntime, pause, reset, skipPhase, start } from './timer';
import { APPEARANCE_LIMITS, isDropReason, isFinishPhrase, isGrade, validateSettings, validateTaskFields } from './validation';
import { bumpDay } from './record';
import type { AppData, AppEvent, Appearance, Draft, DropKind, Grade, NewTaskInput, Settings, Task, TimerConfig, TimerEvent } from './types';

export const MAX_EVENTS = 2000;
export const MAX_JOURNAL = 500;
/** A finish counts toward the chain only with at least this much tracked work. */
export const CHAIN_MIN_MS = 10 * 60_000;
const MIN = 60_000;

export type Mutation =
  | { ok: true; data: AppData; timerEvents: TimerEvent[] }
  | { ok: false; error: string; fields?: Record<string, string> };

const ok = (data: AppData, timerEvents: TimerEvent[] = []): Mutation => ({ ok: true, data, timerEvents });
const fail = (error: string, fields?: Record<string, string>): Mutation => ({ ok: false, error, fields });

export function defaultTimer(): TimerConfig {
  return {
    mode: 'countdown',
    countdown: { durationMs: 25 * MIN, onExpire: 'stop' },
    pomodoro: { workMs: 25 * MIN, shortBreakMs: 5 * MIN, longBreakMs: 15 * MIN, sessionsBeforeLongBreak: 4, autoStartBreaks: false, autoStartWork: false },
  };
}

export function defaultAppearance(): Appearance {
  return { statusPx: 11, titlePx: 17, digitsPx: 34, barPx: 3 };
}

export function defaultSettings(): Settings {
  return {
    defaultTimer: defaultTimer(),
    idleOpacity: 0.65,
    soundEnabled: true,
    notificationsEnabled: true,
    launchAtStartup: false,
    shortcutsEnabled: true,
    shortcuts: { togglePanel: 'Ctrl+Alt+Space', startPause: 'Ctrl+Alt+P' },
    appearance: defaultAppearance(),
    theme: 'graphite',
    accent: null,
    onboarded: false,
  };
}

export function emptyData(): AppData {
  return {
    version: 2,
    tasks: [],
    settings: defaultSettings(),
    windowPos: null,
    events: [],
    days: {},
    journal: [],
    bests: { longestStretchMs: 0 },
    chain: { current: 0, best: 0 },
    orphanedDeletedMs: 0,
  };
}

export function activeTask(data: Pick<AppData, 'tasks'>): Task | null {
  return data.tasks.find((t) => t.status === 'active') ?? null;
}

export function queuedTasks(data: Pick<AppData, 'tasks'>): Task[] {
  return data.tasks.filter((t) => t.status === 'queued');
}

/** Finish condition is editable only until the timer is first started. */
export function isLocked(task: Task): boolean {
  return task.startedAt !== null;
}

export function trackedMs(task: Task, now: number): number {
  const live = task.runtime.sliceStartedAt !== null ? Math.max(0, now - task.runtime.sliceStartedAt) : 0;
  return task.workMs + task.breakMs + live;
}

export function needsDeleteConfirm(task: Task, now: number): boolean {
  return trackedMs(task, now) > 0;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

export function clampAppearance(a: Appearance): Appearance {
  const L = APPEARANCE_LIMITS;
  return {
    statusPx: clamp(a.statusPx, L.statusPx[0], L.statusPx[1]),
    titlePx: clamp(a.titlePx, L.titlePx[0], L.titlePx[1]),
    digitsPx: clamp(a.digitsPx, L.digitsPx[0], L.digitsPx[1]),
    barPx: clamp(a.barPx, L.barPx[0], L.barPx[1]),
  };
}

/** Restore the invariant. Any non-active task left running is stopped at `now`. */
export function normalize(data: AppData, now: number): AppData {
  let seenActive = false;
  const tasks = data.tasks.map((t) => {
    if (t.status === 'completed') return t;
    const status: Task['status'] = seenActive ? 'queued' : 'active';
    seenActive = true;
    let task = t.status === status ? t : { ...t, status };
    if (status === 'active' && t.status !== 'active') task = { ...task, activatedAt: now };
    if (status === 'queued' && task.runtime.status === 'running') {
      task = closeSlice(task, now);
      task = { ...task, runtime: { ...task.runtime, status: 'paused' } };
    }
    return task;
  });
  const s = data.settings;
  const settings = { ...s, idleOpacity: clamp(s.idleOpacity, 0, 1), appearance: clampAppearance(s.appearance) };
  return { ...data, tasks, settings, events: data.events.slice(-MAX_EVENTS), journal: data.journal.slice(-MAX_JOURNAL) };
}

function withEvent(data: AppData, ev: AppEvent): AppData {
  return { ...data, events: [...data.events, ev].slice(-MAX_EVENTS) };
}

function replaceTask(data: AppData, task: Task): AppData {
  return { ...data, tasks: data.tasks.map((t) => (t.id === task.id ? task : t)) };
}

export function createTask(input: NewTaskInput, settings: Settings, now: number, id: string): Task {
  return {
    id,
    name: input.name.trim(),
    finishCondition: input.finishCondition.trim(),
    priority: input.priority ?? 'none',
    estimateMs: input.estimateMs ?? null,
    status: 'queued',
    timer: structuredClone(input.timer ?? settings.defaultTimer),
    runtime: idleRuntime(),
    workMs: 0,
    breakMs: 0,
    pomodorosCompleted: 0,
    sessions: [],
    createdAt: now,
    activatedAt: null,
    startedAt: null,
    startLatencyMs: null,
    completedAt: null,
    droppedCount: 0,
    lostFocusDrops: 0,
  };
}

export function addTask(data: AppData, input: NewTaskInput, now: number, id: string): Mutation {
  const errors = validateTaskFields(input);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  return ok(normalize({ ...data, tasks: [...data.tasks, createTask(input, data.settings, now, id)] }, now));
}

/** Deleting unfinished work does not erase it from the record: its work time becomes orphaned. */
export function deleteTask(data: AppData, taskId: string, confirmed: boolean, now: number): Mutation {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) return fail('Task not found.');
  if (needsDeleteConfirm(task, now) && !confirmed) return fail('confirm-required');
  const orphaned = task.status !== 'completed' ? task.workMs : 0;
  return ok(normalize({ ...data, tasks: data.tasks.filter((t) => t.id !== taskId), orphanedDeletedMs: data.orphanedDeletedMs + orphaned }, now));
}

/** Reorder queued tasks only; the active task always stays first. */
export function moveTask(data: AppData, taskId: string, direction: 'up' | 'down', now: number): Mutation {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'queued') return fail('Only queued tasks can be reordered.');
  const queue = queuedTasks(data);
  const i = queue.findIndex((t) => t.id === taskId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= queue.length) return ok(data);
  [queue[i], queue[j]] = [queue[j], queue[i]];
  const active = activeTask(data);
  const done = data.tasks.filter((t) => t.status === 'completed');
  return ok(normalize({ ...data, tasks: [...(active ? [active] : []), ...queue, ...done] }, now));
}

export function timerCommand(data: AppData, action: 'start' | 'pause' | 'reset' | 'skip', now: number): Mutation {
  const task = activeTask(data);
  if (!task) return fail('No task in focus.');
  if (action === 'start') {
    if (task.runtime.status === 'running') return ok(data);
    let next = start(advance(task, now).task, now);
    let d = data;
    if (next.startedAt === null) {
      next = { ...next, startedAt: now, startLatencyMs: Math.max(0, now - (task.activatedAt ?? task.createdAt)) };
      d = withEvent({ ...d, days: bumpDay(d.days, now, 'started') }, { type: 'started', taskId: task.id, at: now });
    }
    return ok(replaceTask(d, next));
  }
  if (action === 'pause') {
    const res = pause(task, now);
    // Only a slice the user actually cut short counts as a pause.
    const userPaused = task.runtime.status === 'running' && res.task.runtime.status === 'paused';
    const d = userPaused ? { ...data, days: bumpDay(data.days, now, 'pauses') } : data;
    return ok(replaceTask(d, res.task), res.events);
  }
  if (action === 'reset') return ok(replaceTask(data, reset(task, now)));
  if (task.timer.mode !== 'pomodoro') return fail('Skip is only available in Pomodoro mode.');
  const res = skipPhase(task, now);
  return ok(replaceTask(data, res.task), res.events);
}

/** Stop the timer (keeping totals), then finish. Requires the exact phrase and a self-grade. */
export function completeTask(data: AppData, taskId: string, phrase: string, grade: Grade, now: number): Mutation {
  const task = activeTask(data);
  if (!task || task.id !== taskId) return fail('Only the task in focus can be finished.');
  if (!isFinishPhrase(phrase)) return fail('Type the phrase exactly: I have finished this task');
  if (!isGrade(grade)) return fail('Choose how fully you finished.');
  const stopped = closeSlice(advance(task, now).task, now);
  const done: Task = { ...stopped, status: 'completed', completedAt: now, runtime: idleRuntime() };
  const entry = {
    at: now,
    taskId,
    trackedMs: done.workMs,
    estimateMs: done.estimateMs,
    startLatencyMs: done.startLatencyMs ?? 0,
    grade,
    clean: done.lostFocusDrops === 0,
  };
  const counts = done.workMs >= CHAIN_MIN_MS;
  const current = counts ? data.chain.current + 1 : data.chain.current;
  // Move it out of the queue order so the next queued task becomes first.
  const rest = data.tasks.filter((t) => t.id !== taskId);
  const d: AppData = {
    ...data,
    tasks: [...rest, done],
    days: bumpDay(data.days, now, 'finished'),
    journal: [...data.journal, entry].slice(-MAX_JOURNAL),
    chain: { current, best: Math.max(data.chain.best, current) },
  };
  return ok(normalize(withEvent(d, { type: 'finished', taskId, at: now }), now));
}

/**
 * Escape hatch: stop, keep time, send to the back of the queue.
 * "Blocked" carries no penalty; "lost focus" orphans the task's time and resets the chain.
 */
export function dropTask(data: AppData, taskId: string, reason: string, kind: DropKind, now: number): Mutation {
  const task = activeTask(data);
  if (!task || task.id !== taskId) return fail('Only the task in focus can be dropped.');
  if (queuedTasks(data).length === 0) return fail('Nothing else is queued. Delete the task instead.');
  if (!isDropReason(reason)) return fail('Give a reason (at least 3 characters).');
  if (kind !== 'blocked' && kind !== 'lostFocus') return fail('Choose why you are dropping it.');
  const lost = kind === 'lostFocus';
  const stopped = closeSlice(advance(task, now).task, now);
  const dropped: Task = {
    ...stopped,
    status: 'queued',
    droppedCount: task.droppedCount + 1,
    lostFocusDrops: task.lostFocusDrops + (lost ? 1 : 0),
    runtime: idleRuntime(),
  };
  const others = data.tasks.filter((t) => t.id !== taskId && t.status !== 'completed');
  const done = data.tasks.filter((t) => t.status === 'completed');
  const d: AppData = {
    ...data,
    tasks: [...others, dropped, ...done],
    days: bumpDay(data.days, now, 'dropped'),
    chain: lost ? { ...data.chain, current: 0 } : data.chain,
  };
  return ok(normalize(withEvent(d, { type: 'dropped', taskId, at: now, reason: reason.trim(), kind }), now));
}

/** Completed -> front of the queue (or active if nothing is). Totals are kept. */
export function reopenTask(data: AppData, taskId: string, now: number): Mutation {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'completed') return fail('Only completed tasks can be reopened.');
  const reopened: Task = { ...task, status: 'queued', completedAt: null, runtime: idleRuntime() };
  const active = activeTask(data);
  const others = data.tasks.filter((t) => t.id !== taskId && t.status !== 'completed' && t.id !== active?.id);
  const done = data.tasks.filter((t) => t.id !== taskId && t.status === 'completed');
  return ok(normalize({ ...data, tasks: [...(active ? [active] : []), reopened, ...others, ...done] }, now));
}

function sameTimer(a: TimerConfig, b: TimerConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Apply the renderer's draft atomically: either every edit is valid and applied,
 * or nothing changes. Runtime is never touched, except that a changed timer
 * config resets the current display (totals and sessions are kept).
 */
export function saveDraft(data: AppData, draft: Draft, now: number): Mutation {
  const fields: Record<string, string> = {};
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  for (const edit of draft.tasks) {
    const task = byId.get(edit.id);
    if (!task) continue; // deleted underneath the draft; ignore
    for (const [k, v] of Object.entries(validateTaskFields(edit))) fields[`${edit.id}.${k}`] = v;
    if (isLocked(task) && edit.finishCondition.trim() !== task.finishCondition) fields[`${edit.id}.finishCondition`] = 'The finish condition is locked once the timer has started.';
    if (task.runtime.status === 'running' && !sameTimer(edit.timer, task.timer)) fields[`${edit.id}.timer`] = 'Pause to change timer settings.';
  }
  if (draft.settings) for (const [k, v] of Object.entries(validateSettings(draft.settings))) fields[`settings.${k}`] = v;
  if (Object.keys(fields).length) return fail('Please fix the highlighted fields.', fields);

  let tasks = data.tasks;
  for (const edit of draft.tasks) {
    tasks = tasks.map((t) => {
      if (t.id !== edit.id) return t;
      const timerChanged = !sameTimer(edit.timer, t.timer);
      return {
        ...t,
        name: edit.name.trim(),
        finishCondition: isLocked(t) ? t.finishCondition : edit.finishCondition.trim(),
        priority: edit.priority,
        estimateMs: edit.estimateMs,
        timer: structuredClone(edit.timer),
        runtime: timerChanged ? idleRuntime() : t.runtime,
      };
    });
  }
  // Flags changed by immediate commands (welcome, tray startup toggle) are not the draft's to overwrite.
  const settings = draft.settings
    ? { ...structuredClone(draft.settings), onboarded: data.settings.onboarded, launchAtStartup: draft.settings.launchAtStartup }
    : data.settings;
  return ok(normalize({ ...data, tasks, settings }, now));
}
