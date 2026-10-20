// Main-process controller + store: persistence, crash/sleep recovery, .bak fallback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Controller } from '../src/main/controller';
import { Store } from '../src/main/store';
import { activeTask } from '../src/shared/tasks';
import { MIN, SEC, T0 } from './helpers';

let dir: string;
let ids = 0;
const newId = () => `id${++ids}`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function boot(now: number): Controller {
  const c = new Controller(new Store(dir), undefined, newId);
  c.init(now);
  return c;
}

function runningTask(): Controller {
  const c = boot(T0);
  const pomo = { mode: 'stopwatch' as const, countdown: { durationMs: 25 * MIN, onExpire: 'stop' as const }, pomodoro: c.data.settings.defaultTimer.pomodoro };
  expect(c.command({ type: 'addTask', input: { name: 'Write report', finishCondition: 'Report sent to the client', estimateMs: 12 * MIN, timer: pomo } }, T0).ok).toBe(true);
  expect(c.command({ type: 'timer', action: 'start' }, T0).ok).toBe(true);
  return c;
}

describe('persistence', () => {
  it('round-trips data through disk', () => {
    const c = runningTask();
    c.setWindowPos({ x: 40, y: 50 });
    const again = boot(T0 + 2 * SEC);
    expect(again.data.tasks).toHaveLength(1);
    expect(again.data.tasks[0].estimateMs).toBe(12 * MIN);
    expect(again.data.windowPos).toEqual({ x: 40, y: 50 });
    expect(again.pendingGap).toBeNull();
    expect(activeTask(again.data)?.runtime.status).toBe('running'); // small gap: seamless
  });

  it('falls back to .bak when the main file is corrupt', () => {
    const c = runningTask();
    c.setWindowPos({ x: 1, y: 2 }); // second save -> .bak holds the earlier state
    const store = new Store(dir);
    fs.writeFileSync(store.file, '{ not json');
    const again = boot(T0);
    expect(again.data.tasks).toHaveLength(1);
  });
});

describe('restart with a running timer', () => {
  it('pauses at the last heartbeat and discard keeps only observed time', () => {
    runningTask();
    new Store(dir).writeHeartbeat(T0 + MIN);
    const c = boot(T0 + 30 * MIN);
    expect(c.pendingGap).toEqual({ from: T0 + MIN, to: T0 + 30 * MIN, reason: 'off' });
    expect(c.command({ type: 'timer', action: 'start' }, T0 + 30 * MIN).ok).toBe(false);
    expect(c.command({ type: 'answerGap', count: false }, T0 + 30 * MIN).ok).toBe(true);
    const t = activeTask(c.data)!;
    expect(t.workMs).toBe(MIN);
    expect(t.runtime.status).toBe('paused');
  });

  it('count credits the gap and stays paused', () => {
    runningTask();
    new Store(dir).writeHeartbeat(T0 + MIN);
    const c = boot(T0 + 30 * MIN);
    c.command({ type: 'answerGap', count: true }, T0 + 31 * MIN);
    const t = activeTask(c.data)!;
    expect(t.workMs).toBe(30 * MIN);
    expect(t.runtime.status).toBe('paused');
    expect(c.pendingGap).toBeNull();
  });
});

describe('runtime ticks', () => {
  it('a long pause between ticks raises a gap; a backwards clock never goes negative', () => {
    const c = runningTask();
    c.tick(T0 + 250);
    c.tick(T0 - 5 * MIN); // clock jumped back
    let t = activeTask(c.data)!;
    expect(t.workMs).toBe(250);
    expect(t.runtime.sliceStartedAt).toBe(T0 - 5 * MIN);
    c.tick(T0 - 5 * MIN + SEC);
    c.tick(T0 + 20 * MIN); // way more than 10 s later
    t = activeTask(c.data)!;
    expect(c.pendingGap?.from).toBe(T0 - 5 * MIN + SEC);
    expect(t.runtime.status).toBe('paused');
    expect(t.workMs).toBe(250 + SEC);
  });

  it('saveDraft leaves the running timer untouched', () => {
    const c = runningTask();
    const before = activeTask(c.data)!;
    const edit = { ...before, name: 'Renamed' };
    expect(c.command({ type: 'saveDraft', draft: { tasks: [edit], settings: { ...c.data.settings, idleOpacity: 0.7 } } }, T0 + MIN).ok).toBe(true);
    const after = activeTask(c.data)!;
    expect(after.name).toBe('Renamed');
    expect(after.runtime).toEqual(before.runtime);
    expect(c.data.settings.idleOpacity).toBe(0.7);
  });
});
