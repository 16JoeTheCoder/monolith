// The app's state machine: owns AppData, runs every command through the pure
// task logic, persists after every change, and handles time the app could not
// observe (crash, power off, sleep, clock jumps). No Electron imports: main.ts
// wires it to the window, tray and powerMonitor, and the tests drive it directly.
//
// Gap handling in one sentence: when we discover that time passed while we were
// not watching, we stop the clock at the last moment we *know* we were alive
// and ask the user whether the unobserved stretch should count.

import { randomUUID } from 'node:crypto';
import { recordWork } from '../shared/record';
import { advance, closeSlice, start } from '../shared/timer';
import * as T from '../shared/tasks';
import type { AppData, Command, CommandResult, Gap, Settings, Task, TimerEvent } from '../shared/types';
import type { Store } from './store';

export const HEARTBEAT_MS = 5_000;
export const STARTUP_GAP_MS = 15_000;
export const TICK_GAP_MS = 10_000;

export interface ControllerHooks {
  onChange(): void;
  onTimerEvents(events: TimerEvent[]): void;
  onSettingsChanged(prev: Settings, next: Settings): void;
  onGap(): void;
}

const noHooks: ControllerHooks = { onChange() {}, onTimerEvents() {}, onSettingsChanged() {}, onGap() {} };

export class Controller {
  data: AppData;
  pendingGap: Gap | null = null;
  private gapTaskId: string | null = null;
  private lastTick = 0;
  private lastHeartbeat = 0;
  private suspendedAt: number | null = null;

  constructor(private store: Store, private hooks: ControllerHooks = noHooks, private newId: () => string = randomUUID) {
    this.data = T.emptyData();
  }

  /** Load from disk and recover a timer that was running when the app last died. */
  init(now: number): void {
    this.data = this.store.load(now);
    this.lastTick = now;
    const task = T.activeTask(this.data);
    const rt = task?.runtime;
    if (task && rt && rt.status === 'running' && rt.sliceStartedAt !== null) {
      const lastAlive = Math.max(this.store.readHeartbeat() ?? 0, rt.sliceStartedAt);
      if (now < lastAlive) {
        // Clock is behind what we recorded: keep what we had, restart from now.
        this.replace(this.restartAt(task, lastAlive, now));
      } else if (now - lastAlive > STARTUP_GAP_MS) {
        this.pauseWithGap(task, lastAlive, { from: lastAlive, to: now, reason: 'off' });
      }
      // Smaller gaps: keep running seamlessly; the slice simply covers the restart.
      this.persist();
    }
  }

  /** Called every 250 ms by main. Detects jumps, processes boundaries, writes heartbeats. */
  tick(now: number): void {
    const prev = this.lastTick;
    this.lastTick = now;
    const task = T.activeTask(this.data);
    if (!task || task.runtime.status !== 'running') return;

    if (now < prev) {
      // Clock moved backwards: bank what we had up to the last tick, then restart.
      this.replace(this.restartAt(task, prev, now));
      this.persist();
      this.hooks.onChange();
      return;
    }
    if (now - prev > TICK_GAP_MS) {
      // We were not scheduled for a while (sleep, suspension, forward jump).
      this.pauseWithGap(task, prev, { from: prev, to: now, reason: 'sleep' });
      this.persist();
      this.hooks.onChange();
      this.hooks.onGap();
      return;
    }
    const res = advance(task, now);
    if (res.events.length || res.task.runtime.status !== task.runtime.status) {
      this.replace(res.task);
      this.persist();
      this.hooks.onTimerEvents(res.events);
      this.hooks.onChange();
    }
    if (res.task.runtime.status === 'running' && now - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = now;
      this.store.writeHeartbeat(now);
    }
  }

  /** powerMonitor 'suspend': stop at this exact moment. */
  suspend(now: number): void {
    const task = T.activeTask(this.data);
    if (!task || task.runtime.status !== 'running') return;
    this.replace(this.pausedAt(task, now));
    this.suspendedAt = now;
    this.gapTaskId = task.id;
    this.persist();
    this.hooks.onChange();
  }

  /** powerMonitor 'resume': ask whether the sleep should count. */
  resume(now: number): void {
    this.lastTick = now;
    if (this.suspendedAt === null) return;
    this.pendingGap = { from: this.suspendedAt, to: now, reason: 'sleep' };
    this.suspendedAt = null;
    this.hooks.onChange();
    this.hooks.onGap();
  }

  shutdown(now: number): void {
    const task = T.activeTask(this.data);
    if (task?.runtime.status === 'running') this.store.writeHeartbeat(now);
  }

  setWindowPos(pos: { x: number; y: number }): void {
    this.data = { ...this.data, windowPos: { x: Math.round(pos.x), y: Math.round(pos.y) } };
    this.persist();
  }

  /** Global shortcut: start or pause the active task. Ignored while a gap prompt is open. */
  toggleStartPause(now: number): void {
    if (this.pendingGap) return;
    const task = T.activeTask(this.data);
    if (!task) return;
    this.command({ type: 'timer', action: task.runtime.status === 'running' ? 'pause' : 'start' }, now);
  }

  command(cmd: Command, now: number): CommandResult {
    const d = this.data;
    let res: T.Mutation;
    switch (cmd.type) {
      case 'addTask':
        res = T.addTask(d, cmd.input, now, this.newId());
        break;
      case 'deleteTask':
        res = T.deleteTask(d, cmd.taskId, cmd.confirmed, now);
        break;
      case 'moveTask':
        res = T.moveTask(d, cmd.taskId, cmd.direction, now);
        break;
      case 'completeTask':
        res = T.completeTask(d, cmd.taskId, cmd.phrase, cmd.grade, now);
        break;
      case 'dropTask':
        res = T.dropTask(d, cmd.taskId, cmd.reason, cmd.kind, now);
        break;
      case 'reopenTask':
        res = T.reopenTask(d, cmd.taskId, now);
        break;
      case 'timer':
        if (this.pendingGap) return { ok: false, error: 'Answer the time-gap question first.' };
        res = T.timerCommand(d, cmd.action, now);
        break;
      case 'answerGap':
        return this.answerGap(cmd.count);
      case 'saveDraft':
        res = T.saveDraft(d, cmd.draft, now);
        break;
      case 'setLaunchAtStartup':
        res = { ok: true, data: { ...d, settings: { ...d.settings, launchAtStartup: cmd.enabled } }, timerEvents: [] };
        break;
      case 'dismissWelcome':
        res = { ok: true, data: { ...d, settings: { ...d.settings, onboarded: true } }, timerEvents: [] };
        break;
      case 'resetAll':
        // Everything goes except where the window sits on screen.
        this.pendingGap = null;
        this.gapTaskId = null;
        this.suspendedAt = null;
        res = { ok: true, data: { ...T.emptyData(), windowPos: d.windowPos }, timerEvents: [] };
        break;
    }
    if (!res.ok) return { ok: false, error: res.error, fields: res.fields };
    const prevSettings = d.settings;
    this.set(res.data);
    this.persist();
    if (res.timerEvents.length) this.hooks.onTimerEvents(res.timerEvents);
    if (prevSettings !== this.data.settings) this.hooks.onSettingsChanged(prevSettings, this.data.settings);
    this.hooks.onChange();
    return { ok: true };
  }

  /**
   * Count: replay the gap as if the timer had run from `from` to `to`, so
   * Pomodoro boundaries inside the gap are honoured (their notifications are
   * suppressed). Discard: stay paused at the last recorded time. Either way the
   * timer ends up paused (or idle at a phase boundary) until the user resumes.
   */
  private answerGap(count: boolean): CommandResult {
    const gap = this.pendingGap;
    if (!gap) return { ok: false, error: 'There is no time gap to answer.' };
    const task = T.activeTask(this.data);
    if (count && task && task.id === this.gapTaskId && task.runtime.status === 'paused') {
      const running: Task = { ...task, runtime: { ...task.runtime, status: 'running', sliceStartedAt: gap.from } };
      this.replace(this.pausedAt(running, gap.to));
    }
    this.pendingGap = null;
    this.gapTaskId = null;
    this.persist();
    this.hooks.onChange();
    return { ok: true };
  }

  /** Process boundaries up to `at` silently, then close the slice there and pause. */
  private pausedAt(task: Task, at: number): Task {
    const t = advance(task, at).task;
    if (t.runtime.status !== 'running') return t;
    const closed = closeSlice(t, at);
    return { ...closed, runtime: { ...closed.runtime, status: 'paused' } };
  }

  private pauseWithGap(task: Task, at: number, gap: Gap): void {
    const paused = this.pausedAt(task, at);
    this.replace(paused);
    if (paused.runtime.status === 'paused') {
      this.pendingGap = gap;
      this.gapTaskId = task.id;
    }
  }

  private restartAt(task: Task, closeAt: number, now: number): Task {
    const t = this.pausedAt(task, closeAt);
    return t.runtime.status === 'paused' ? start(t, now) : t;
  }

  private replace(task: Task): void {
    this.set({ ...this.data, tasks: this.data.tasks.map((t) => (t.id === task.id ? task : t)) });
  }

  /** The single place state changes, so every closed work slice reaches the daily record exactly once. */
  private set(next: AppData): void {
    this.data = recordWork(this.data, next);
  }

  private persist(): void {
    this.store.save(this.data);
  }
}
