// Task and queue logic: the single-focus rules as pure functions over AppData.
// Main runs every command through here, then persists. Each mutation ends with
// normalize(), which restores the invariant: the first non-completed task is the
// one and only active task, everything else not completed is queued.

import { advance, closeSlice, idleRuntime, pause, reset, skipPhase, start } from './timer';
import { isDropReason, isFinishPhrase, validateSettings, validateTaskFields } from './validation';
import { startOfDay, startOfWeek } from './format';
import type { AppData, AppEvent, Draft, NewTaskInput, Settings, Task, TimerConfig, TimerEvent } from './types';

export const MAX_EVENTS = 2000;
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

export function defaultSettings(): Settings {
  return {
    defaultTimer: defaultTimer(),
    idleOpacity: 0.65,
    currency: 'IDR',
    soundEnabled: true,
    notificationsEnabled: true,
    launchAtStartup: false,
    shortcutsEnabled: true,
    shortcuts: { togglePanel: 'Ctrl+Alt+Space', startPause: 'Ctrl+Alt+P' },
    showMoneyInCompact: false,
  };
}

export function emptyData(): AppData {
  return { version: 1, tasks: [], settings: defaultSettings(), windowPos: null, events: [] };
}

export function activeTask(data: AppData): Task | null {
  return data.tasks.find((t) => t.status === 'active') ?? null;
}

export function queuedTasks(data: AppData): Task[] {
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

/** Restore the invariant. Any non-active task left running is stopped at `now`. */
export function normalize(data: AppData, now: number): AppData {
  let seenActive = false;
  const tasks = data.tasks.map((t) => {
    if (t.status === 'completed') return t;
    const status: Task['status'] = seenActive ? 'queued' : 'active';
    seenActive = true;
    let task = t.status === status ? t : { ...t, status };
    if (status === 'queued' && task.runtime.status === 'running') {
      task = closeSlice(task, now);
      task = { ...task, runtime: { ...task.runtime, status: 'paused' } };
    }
    return task;
  });
  const settings = { ...data.settings, idleOpacity: Math.min(0.8, Math.max(0.5, data.settings.idleOpacity)) };
  return { ...data, tasks, settings, events: data.events.slice(-MAX_EVENTS) };
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
    notes: input.notes ?? '',
    finishCondition: input.finishCondition.trim(),
    priority: input.priority ?? 'none',
    value: input.value ?? 0,
    valueIsEarned: input.valueIsEarned ?? false,
    deadline: input.deadline ?? null,
    estimateMs: input.estimateMs ?? null,
    status: 'queued',
    timer: structuredClone(input.timer ?? settings.defaultTimer),
    runtime: idleRuntime(),
    workMs: 0,
    breakMs: 0,
    pomodorosCompleted: 0,
    sessions: [],
    createdAt: now,
    startedAt: null,
    completedAt: null,
    droppedCount: 0,
  };
}

export function addTask(data: AppData, input: NewTaskInput, now: number, id: string): Mutation {
  const errors = validateTaskFields(input);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  return ok(normalize({ ...data, tasks: [...data.tasks, createTask(input, data.settings, now, id)] }, now));
}

export function deleteTask(data: AppData, taskId: string, confirmed: boolean, now: number): Mutation {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) return fail('Task not found.');
  if (needsDeleteConfirm(task, now) && !confirmed) return fail('confirm-required');
  return ok(normalize({ ...data, tasks: data.tasks.filter((t) => t.id !== taskId) }, now));
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
      next = { ...next, startedAt: now };
      d = withEvent(d, { type: 'started', taskId: task.id, at: now });
    }
    return ok(replaceTask(d, next));
  }
  if (action === 'pause') {
    const res = pause(task, now);
    return ok(replaceTask(data, res.task), res.events);
  }
  if (action === 'reset') return ok(replaceTask(data, reset(task, now)));
  if (task.timer.mode !== 'pomodoro') return fail('Skip is only available in Pomodoro mode.');
  const res = skipPhase(task, now);
  return ok(replaceTask(data, res.task), res.events);
}

/** Stop the timer (keeping totals), then finish. Requires the exact phrase. */
export function completeTask(data: AppData, taskId: string, phrase: string, now: number): Mutation {
  const task = activeTask(data);
  if (!task || task.id !== taskId) return fail('Only the task in focus can be finished.');
  if (!isFinishPhrase(phrase)) return fail('Type the phrase exactly: I have finished this task');
  const stopped = closeSlice(advance(task, now).task, now);
  const done: Task = { ...stopped, status: 'completed', completedAt: now, runtime: idleRuntime() };
  // Move it out of the queue order so the next queued task becomes first.
  const rest = data.tasks.filter((t) => t.id !== taskId);
  return ok(normalize(withEvent({ ...data, tasks: [...rest, done] }, { type: 'finished', taskId, at: now }), now));
}

/** Escape hatch: stop, keep time, send to the back of the queue. */
export function dropTask(data: AppData, taskId: string, reason: string, now: number): Mutation {
  const task = activeTask(data);
  if (!task || task.id !== taskId) return fail('Only the task in focus can be dropped.');
  if (queuedTasks(data).length === 0) return fail('Nothing else is queued. Delete the task instead.');
  if (!isDropReason(reason)) return fail('Give a reason (at least 3 characters).');
  const stopped = closeSlice(advance(task, now).task, now);
  const dropped: Task = { ...stopped, status: 'queued', droppedCount: task.droppedCount + 1, runtime: idleRuntime() };
  const others = data.tasks.filter((t) => t.id !== taskId && t.status !== 'completed');
  const done = data.tasks.filter((t) => t.status === 'completed');
  const d = withEvent({ ...data, tasks: [...others, dropped, ...done] }, { type: 'dropped', taskId, at: now, reason: reason.trim() });
  return ok(normalize(d, now));
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
        notes: edit.notes,
        finishCondition: isLocked(t) ? t.finishCondition : edit.finishCondition.trim(),
        priority: edit.priority,
        value: edit.value,
        valueIsEarned: edit.valueIsEarned,
        deadline: edit.deadline,
        estimateMs: edit.estimateMs,
        timer: structuredClone(edit.timer),
        runtime: timerChanged ? idleRuntime() : t.runtime,
      };
    });
  }
  return ok(normalize({ ...data, tasks, settings: draft.settings ? structuredClone(draft.settings) : data.settings }, now));
}

export interface Stats {
  started: number;
  finished: number;
  dropped: number;
  focusedToday: number;
  focusedWeek: number;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Weekly counts and focused (work-only) time, including the live running slice. */
export function computeStats(data: AppData, now: number): Stats {
  const week = startOfWeek(now);
  const day = startOfDay(now);
  const inWeek = data.events.filter((e) => e.at >= week && e.at <= now);
  let focusedToday = 0;
  let focusedWeek = 0;
  for (const t of data.tasks) {
    const spans = t.sessions.filter((s) => s.kind === 'work').map((s) => [s.startedAt, s.endedAt]);
    const rt = t.runtime;
    const liveIsBreak = t.timer.mode === 'pomodoro' && rt.phase !== 'work';
    if (rt.sliceStartedAt !== null && !liveIsBreak) spans.push([rt.sliceStartedAt, Math.max(rt.sliceStartedAt, now)]);
    for (const [a, b] of spans) {
      focusedToday += overlap(a, b, day, now);
      focusedWeek += overlap(a, b, week, now);
    }
  }
  return {
    started: inWeek.filter((e) => e.type === 'started').length,
    finished: inWeek.filter((e) => e.type === 'finished').length,
    dropped: inWeek.filter((e) => e.type === 'dropped').length,
    focusedToday,
    focusedWeek,
  };
}

export interface MoneyTotals {
  value: number;
  earned: number;
  ratePerHour: number | null;
}

/** "est." rate: value of completed tasks that have both value and tracked work, per tracked hour. */
export function moneyTotals(tasks: Task[]): MoneyTotals {
  const done = tasks.filter((t) => t.status === 'completed');
  const value = done.reduce((s, t) => s + t.value, 0);
  const earned = done.filter((t) => t.valueIsEarned).reduce((s, t) => s + t.value, 0);
  const rated = done.filter((t) => t.value > 0 && t.workMs > 0);
  const hours = rated.reduce((s, t) => s + t.workMs, 0) / 3_600_000;
  return { value, earned, ratePerHour: hours > 0 ? rated.reduce((s, t) => s + t.value, 0) / hours : null };
}
