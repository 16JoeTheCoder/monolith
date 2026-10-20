// Timer engine: pure functions over a task's runtime, always given an explicit
// `now`. Time is never counted with an interval; it is derived from timestamps.
// A "slice" is one uninterrupted running stretch (sliceStartedAt .. end). Closing
// a slice folds it into phaseElapsedMs and the work/break totals and records a
// session. Because boundaries are computed from timestamps, a sleeping laptop,
// a throttled renderer or a late tick can never make the clock drift.

import type { Phase, Runtime, Session, Task, TimerEvent } from './types';

export const MAX_SESSIONS = 300;
const MAX_TRANSITIONS = 1000;

export function idleRuntime(): Runtime {
  return { status: 'idle', phase: 'work', phaseElapsedMs: 0, sliceStartedAt: null, cycleSessions: 0, expiredNotified: false };
}

/** Elapsed time in the current phase. A clock that moved backwards contributes 0, never negative. */
export function phaseElapsed(rt: Runtime, now: number): number {
  return rt.phaseElapsedMs + (rt.sliceStartedAt !== null ? Math.max(0, now - rt.sliceStartedAt) : 0);
}

export function phaseDuration(task: Task, phase: Phase = task.runtime.phase): number | null {
  const { mode, countdown, pomodoro } = task.timer;
  if (mode === 'countdown') return countdown.durationMs;
  if (mode === 'stopwatch') return null;
  if (phase === 'work') return pomodoro.workMs;
  return phase === 'shortBreak' ? pomodoro.shortBreakMs : pomodoro.longBreakMs;
}

function isBreak(phase: Phase): boolean {
  return phase !== 'work';
}

/** Close the running slice at `at`, crediting work or break time. No-op if not running. */
export function closeSlice(task: Task, at: number): Task {
  const rt = task.runtime;
  if (rt.sliceStartedAt === null) return task;
  const end = Math.max(at, rt.sliceStartedAt);
  const ms = end - rt.sliceStartedAt;
  const kind: Session['kind'] = task.timer.mode === 'pomodoro' && isBreak(rt.phase) ? 'break' : 'work';
  const sessions = ms > 0 ? [...task.sessions, { startedAt: rt.sliceStartedAt, endedAt: end, ms, kind }].slice(-MAX_SESSIONS) : task.sessions;
  return {
    ...task,
    workMs: task.workMs + (kind === 'work' ? ms : 0),
    breakMs: task.breakMs + (kind === 'break' ? ms : 0),
    sessions,
    runtime: { ...rt, phaseElapsedMs: rt.phaseElapsedMs + ms, sliceStartedAt: null },
  };
}

/** Process every boundary crossed up to `now`. Returns the new task and the events fired. */
export function advance(task: Task, now: number): { task: Task; events: TimerEvent[] } {
  const events: TimerEvent[] = [];
  let t = task;
  for (let guard = 0; guard < MAX_TRANSITIONS; guard++) {
    const rt = t.runtime;
    if (rt.status !== 'running' || rt.sliceStartedAt === null) break;
    const dur = phaseDuration(t);
    if (dur === null || phaseElapsed(rt, now) < dur) break;
    // The exact instant this phase ended, independent of when we noticed it.
    const end = rt.sliceStartedAt + Math.max(0, dur - rt.phaseElapsedMs);

    if (t.timer.mode === 'countdown') {
      if (t.timer.countdown.onExpire === 'stop') {
        t = closeSlice(t, end);
        t = { ...t, runtime: { ...t.runtime, status: 'completed', phaseElapsedMs: dur, expiredNotified: true } };
        events.push({ kind: 'countdownExpired', taskId: t.id, from: 'work', to: 'work', autoStarted: false });
      } else if (!rt.expiredNotified) {
        t = { ...t, runtime: { ...rt, expiredNotified: true } };
        events.push({ kind: 'countdownExpired', taskId: t.id, from: 'work', to: 'work', autoStarted: true });
      }
      break;
    }

    // Pomodoro: close at the phase end, not at `now`, so a late tick never
    // leaks break time into work (or the reverse).
    t = closeSlice(t, end);
    const p = t.timer.pomodoro;
    const from = t.runtime.phase;
    let next: Phase = 'work';
    let pomodoros = t.pomodorosCompleted;
    let cycle = t.runtime.cycleSessions;
    if (from === 'work') {
      pomodoros += 1;
      cycle += 1;
      if (cycle >= p.sessionsBeforeLongBreak) {
        next = 'longBreak';
        cycle = 0;
      } else {
        next = 'shortBreak';
      }
    }
    const autoStart = isBreak(next) ? p.autoStartBreaks : p.autoStartWork;
    t = {
      ...t,
      pomodorosCompleted: pomodoros,
      runtime: {
        ...t.runtime,
        phase: next,
        cycleSessions: cycle,
        phaseElapsedMs: 0,
        status: autoStart ? 'running' : 'idle',
        sliceStartedAt: autoStart ? end : null,
      },
    };
    events.push({ kind: 'phaseEnded', taskId: t.id, from, to: next, autoStarted: autoStart });
  }
  return { task: t, events };
}

/** Start or resume. Starting a countdown that already ran out begins a fresh round (totals kept). */
export function start(task: Task, now: number): Task {
  if (task.runtime.status === 'running') return task;
  let rt = task.runtime;
  if (rt.status === 'completed') rt = { ...rt, phaseElapsedMs: 0, expiredNotified: false };
  return { ...task, runtime: { ...rt, status: 'running', sliceStartedAt: now } };
}

export function pause(task: Task, now: number): { task: Task; events: TimerEvent[] } {
  const res = advance(task, now);
  if (res.task.runtime.status !== 'running') return res;
  const closed = closeSlice(res.task, now);
  return { task: { ...closed, runtime: { ...closed.runtime, status: 'paused' } }, events: res.events };
}

/** Zero the current display and cycle. Totals and sessions stay. */
export function reset(task: Task, now: number): Task {
  const closed = closeSlice(advance(task, now).task, now);
  return { ...closed, runtime: idleRuntime() };
}

/** Pomodoro only: end the current phase now. Skipping work earns no pomodoro credit. */
export function skipPhase(task: Task, now: number): { task: Task; events: TimerEvent[] } {
  if (task.timer.mode !== 'pomodoro') return { task, events: [] };
  const res = advance(task, now);
  const t = closeSlice(res.task, now);
  const from = t.runtime.phase;
  let next: Phase = 'work';
  let cycle = t.runtime.cycleSessions;
  if (from === 'work') {
    next = cycle + 1 >= t.timer.pomodoro.sessionsBeforeLongBreak ? 'longBreak' : 'shortBreak';
    if (next === 'longBreak') cycle = 0;
  }
  const autoStart = isBreak(next) ? t.timer.pomodoro.autoStartBreaks : t.timer.pomodoro.autoStartWork;
  const task2: Task = {
    ...t,
    runtime: { ...t.runtime, phase: next, cycleSessions: cycle, phaseElapsedMs: 0, status: autoStart ? 'running' : 'idle', sliceStartedAt: autoStart ? now : null },
  };
  return { task: task2, events: [...res.events, { kind: 'phaseEnded', taskId: t.id, from, to: next, autoStarted: autoStart }] };
}

export interface TimerDisplay {
  status: Task['runtime']['status'];
  phase: Phase;
  elapsed: number;
  remaining: number | null;
  overtime: number;
  progress: number | null;
  expired: boolean;
  workMs: number;
  breakMs: number;
  pomodorosCompleted: number;
  cycle: number;
}

/** What to show right now. Used by the renderer every frame and by main for shortcuts/tray. */
export function display(task: Task, now: number, estimateMs: number | null = task.estimateMs): TimerDisplay {
  const t = advance(task, now).task;
  const rt = t.runtime;
  const elapsed = phaseElapsed(rt, now);
  const live = rt.sliceStartedAt !== null ? Math.max(0, now - rt.sliceStartedAt) : 0;
  const liveIsBreak = t.timer.mode === 'pomodoro' && isBreak(rt.phase);
  const workMs = t.workMs + (liveIsBreak ? 0 : live);
  const breakMs = t.breakMs + (liveIsBreak ? live : 0);
  const dur = phaseDuration(t);
  let remaining: number | null = null;
  let overtime = 0;
  let progress: number | null = null;
  if (dur !== null) {
    remaining = Math.max(0, dur - elapsed);
    overtime = Math.max(0, elapsed - dur);
    progress = dur > 0 ? Math.min(1, elapsed / dur) : 1;
  } else if (estimateMs && estimateMs > 0) {
    progress = Math.min(1, workMs / estimateMs);
  }
  const expired = t.timer.mode === 'countdown' && dur !== null && elapsed >= dur;
  return {
    status: rt.status,
    phase: rt.phase,
    elapsed,
    remaining,
    overtime,
    progress,
    expired,
    workMs,
    breakMs,
    pomodorosCompleted: t.pomodorosCompleted,
    cycle: Math.min(rt.cycleSessions + 1, t.timer.pomodoro.sessionsBeforeLongBreak),
  };
}
