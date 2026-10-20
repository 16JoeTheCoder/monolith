// IPC handlers. Everything arriving from the renderer is untrusted: the sender
// must be our window, and every payload is rebuilt field by field from known
// keys before it reaches the controller (which validates values again).

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { CHANNELS } from '../shared/api';
import { validateDraft } from '../shared/validation';
import type { Command, CommandResult, Draft, NewTaskInput, Settings, Snapshot, TaskEdit } from '../shared/types';

export interface IpcDeps {
  isOurSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean;
  snapshot(): Snapshot;
  command(cmd: Command): CommandResult;
  expand(): void;
  collapse(): void;
  reportHeight(h: number): void;
  dragStart(): void;
  dragEnd(): boolean;
  quit(): void;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown): string | null => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null);

function pickTimer(v: unknown): TaskEdit['timer'] {
  // Shape is checked by validateTimer later; here we only copy known keys.
  const t = isObj(v) ? v : {};
  const c = isObj(t.countdown) ? t.countdown : {};
  const p = isObj(t.pomodoro) ? t.pomodoro : {};
  return {
    mode: t.mode as TaskEdit['timer']['mode'],
    countdown: { durationMs: c.durationMs as number, onExpire: c.onExpire as 'stop' | 'continue' },
    pomodoro: {
      workMs: p.workMs as number,
      shortBreakMs: p.shortBreakMs as number,
      longBreakMs: p.longBreakMs as number,
      sessionsBeforeLongBreak: p.sessionsBeforeLongBreak as number,
      autoStartBreaks: p.autoStartBreaks as boolean,
      autoStartWork: p.autoStartWork as boolean,
    },
  };
}

function pickTaskFields(v: Obj): Omit<TaskEdit, 'id'> {
  return {
    name: str(v.name, 200),
    notes: str(v.notes, 4000),
    finishCondition: str(v.finishCondition),
    priority: (v.priority ?? 'none') as TaskEdit['priority'],
    value: (v.value ?? 0) as number,
    valueIsEarned: (v.valueIsEarned ?? false) as boolean,
    deadline: (v.deadline ?? null) as string | null,
    estimateMs: (v.estimateMs ?? null) as number | null,
    timer: pickTimer(v.timer),
  };
}

function pickSettings(v: Obj): Settings {
  const sc = isObj(v.shortcuts) ? v.shortcuts : {};
  return {
    defaultTimer: pickTimer(v.defaultTimer),
    idleOpacity: v.idleOpacity as number,
    currency: v.currency as Settings['currency'],
    soundEnabled: v.soundEnabled as boolean,
    notificationsEnabled: v.notificationsEnabled as boolean,
    launchAtStartup: v.launchAtStartup as boolean,
    shortcutsEnabled: v.shortcutsEnabled as boolean,
    shortcuts: { togglePanel: str(sc.togglePanel, 60), startPause: str(sc.startPause, 60) },
    showMoneyInCompact: v.showMoneyInCompact as boolean,
  };
}

/** Turn an untrusted payload into a well-typed Command, or null. */
export function parseCommand(raw: unknown): Command | null {
  if (!isObj(raw)) return null;
  const taskId = id(raw.taskId);
  switch (raw.type) {
    case 'addTask': {
      if (!isObj(raw.input)) return null;
      const f = pickTaskFields(raw.input);
      const input: NewTaskInput = { ...f, timer: raw.input.timer === undefined ? undefined : f.timer };
      return { type: 'addTask', input };
    }
    case 'deleteTask':
      return taskId ? { type: 'deleteTask', taskId, confirmed: raw.confirmed === true } : null;
    case 'moveTask':
      return taskId && (raw.direction === 'up' || raw.direction === 'down') ? { type: 'moveTask', taskId, direction: raw.direction } : null;
    case 'completeTask':
      return taskId ? { type: 'completeTask', taskId, phrase: str(raw.phrase, 200) } : null;
    case 'dropTask':
      return taskId ? { type: 'dropTask', taskId, reason: str(raw.reason, 500) } : null;
    case 'reopenTask':
      return taskId ? { type: 'reopenTask', taskId } : null;
    case 'timer':
      return ['start', 'pause', 'reset', 'skip'].includes(raw.action as string) ? { type: 'timer', action: raw.action as 'start' } : null;
    case 'answerGap':
      return typeof raw.count === 'boolean' ? { type: 'answerGap', count: raw.count } : null;
    case 'setLaunchAtStartup':
      return typeof raw.enabled === 'boolean' ? { type: 'setLaunchAtStartup', enabled: raw.enabled } : null;
    case 'saveDraft': {
      const d = raw.draft;
      if (!isObj(d) || !Array.isArray(d.tasks) || d.tasks.length > 1000) return null;
      const tasks: TaskEdit[] = [];
      for (const t of d.tasks) {
        const tid = isObj(t) ? id(t.id) : null;
        if (!tid) return null;
        tasks.push({ id: tid, ...pickTaskFields(t as Obj) });
      }
      const draft: Draft = { tasks, settings: isObj(d.settings) ? pickSettings(d.settings) : null };
      // Structural problems are rejected here; field errors flow back as inline messages.
      return validateDraft(draft).draft ? null : { type: 'saveDraft', draft };
    }
    default:
      return null;
  }
}

export function registerIpc(deps: IpcDeps): void {
  const guard = <A extends unknown[], R>(fallback: R, fn: (...a: A) => R) =>
    (e: IpcMainEvent | IpcMainInvokeEvent, ...a: A): R => (deps.isOurSender(e) ? fn(...a) : fallback);

  ipcMain.handle(CHANNELS.getSnapshot, guard(null, () => deps.snapshot()));
  ipcMain.handle(
    CHANNELS.command,
    guard<[unknown], CommandResult>({ ok: false, error: 'Forbidden' }, (raw) => {
      const cmd = parseCommand(raw);
      return cmd ? deps.command(cmd) : { ok: false, error: 'Invalid command.' };
    }),
  );
  ipcMain.handle(CHANNELS.expand, guard(undefined, () => deps.expand()));
  ipcMain.handle(CHANNELS.collapse, guard(undefined, () => deps.collapse()));
  ipcMain.handle(CHANNELS.dragEnd, guard(false, () => deps.dragEnd()));
  ipcMain.on(CHANNELS.reportHeight, guard<[unknown], void>(undefined, (h) => {
    if (typeof h === 'number' && Number.isFinite(h)) deps.reportHeight(h);
  }));
  ipcMain.on(CHANNELS.dragStart, guard(undefined, () => deps.dragStart()));
  ipcMain.on(CHANNELS.quit, guard(undefined, () => deps.quit()));
}
