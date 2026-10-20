// Single-focus rules: complete, drop, reopen, delete, reorder, validation.
import { describe, expect, it } from 'vitest';
import {
  activeTask, addTask, completeTask, deleteTask, dropTask, moveTask, reopenTask, saveDraft, timerCommand,
} from '../src/shared/tasks';
import { isFinishPhrase, validateTaskFields, validateTimer } from '../src/shared/validation';
import { MIN, SEC, T0, dataWith, must } from './helpers';
import type { TaskEdit } from '../src/shared/types';

const PHRASE = 'I have finished this task';

describe('finish phrase', () => {
  it('accepts case, whitespace and trailing period variations only', () => {
    expect(isFinishPhrase('  i HAVE   finished this task. ')).toBe(true);
    expect(isFinishPhrase('I have finished this task')).toBe(true);
    expect(isFinishPhrase('I have finished the task')).toBe(false);
    expect(isFinishPhrase('I have finished this task!!')).toBe(false);
  });
});

describe('queue rules', () => {
  it('first task is active, the rest queued', () => {
    const d = dataWith('a', 'b', 'c');
    expect(d.tasks.map((t) => t.status)).toEqual(['active', 'queued', 'queued']);
  });

  it('completing attributes time only to that task and promotes the next (idle)', () => {
    let d = must(timerCommand(dataWith('a', 'b'), 'start', T0)).data;
    d = must(completeTask(d, 'a', PHRASE, 'fully', T0 + 7 * MIN)).data;
    const a = d.tasks.find((t) => t.id === 'a')!;
    const b = d.tasks.find((t) => t.id === 'b')!;
    expect(a.status).toBe('completed');
    expect(a.workMs).toBe(7 * MIN);
    expect(b.status).toBe('active');
    expect(b.workMs).toBe(0);
    expect(b.runtime.status).toBe('idle');
    expect(completeTask(d, 'b', 'done', 'fully', T0).ok).toBe(false);
  });

  it('drop sends the task to the back, keeps time and needs a reason', () => {
    let d = must(timerCommand(dataWith('a', 'b', 'c'), 'start', T0)).data;
    expect(dropTask(d, 'a', 'no', 'blocked', T0 + MIN).ok).toBe(false);
    d = must(dropTask(d, 'a', 'blocked on review', 'blocked', T0 + 3 * MIN)).data;
    expect(d.tasks.filter((t) => t.status !== 'completed').map((t) => t.id)).toEqual(['b', 'c', 'a']);
    const a = d.tasks.find((t) => t.id === 'a')!;
    expect(a.workMs).toBe(3 * MIN);
    expect(a.droppedCount).toBe(1);
    expect(a.runtime.status).toBe('idle');
    expect(d.events.at(-1)?.type).toBe('dropped');
  });

  it('drop is refused when nothing else is queued', () => {
    expect(dropTask(dataWith('a'), 'a', 'whatever', 'blocked', T0).ok).toBe(false);
  });

  it('reopen puts a completed task at the front of the queue, keeping totals', () => {
    let d = must(timerCommand(dataWith('a', 'b', 'c'), 'start', T0)).data;
    d = must(completeTask(d, 'a', PHRASE, 'fully', T0 + MIN)).data;
    d = must(reopenTask(d, 'a', T0 + 2 * MIN)).data;
    expect(d.tasks.filter((t) => t.status !== 'completed').map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(d.tasks.find((t) => t.id === 'a')!.workMs).toBe(MIN);
    let solo = must(completeTask(dataWith('x'), 'x', PHRASE, 'fully', T0)).data;
    solo = must(reopenTask(solo, 'x', T0)).data;
    expect(activeTask(solo)?.id).toBe('x');
  });

  it('delete requires confirmation only when time was tracked, and promotes the next', () => {
    let d = must(timerCommand(dataWith('a', 'b'), 'start', T0)).data;
    expect(deleteTask(dataWith('a'), 'a', false, T0).ok).toBe(true);
    const r = deleteTask(d, 'a', false, T0 + 5 * SEC);
    expect(r.ok === false && r.error).toBe('confirm-required');
    d = must(deleteTask(d, 'a', true, T0 + 5 * SEC)).data;
    expect(activeTask(d)?.id).toBe('b');
  });

  it('reorder never moves a queued task above the active one', () => {
    let d = dataWith('a', 'b', 'c');
    d = must(moveTask(d, 'b', 'up', T0)).data;
    expect(d.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    d = must(moveTask(d, 'c', 'up', T0)).data;
    expect(d.tasks.map((t) => t.id)).toEqual(['a', 'c', 'b']);
    expect(moveTask(d, 'a', 'down', T0).ok).toBe(false);
  });
});

describe('validation', () => {
  it('requires a finish condition', () => {
    expect(validateTaskFields({ name: 'x', finishCondition: 'short' }).finishCondition).toBeDefined();
    expect(validateTaskFields({ name: 'x', finishCondition: 'long enough text', estimateMs: 30 * MIN, priority: 'high' })).toEqual({});
    expect(addTask(dataWith(), { name: 'x', finishCondition: 'nope' }, T0, 'x').ok).toBe(false);
  });

  it('rejects invalid durations', () => {
    const base = dataWith('a').tasks[0].timer;
    expect(validateTimer({ ...base, countdown: { durationMs: 500, onExpire: 'stop' } })['timer.countdown']).toBeDefined();
    expect(validateTimer({ ...base, countdown: { durationMs: 25 * 3_600_000, onExpire: 'stop' } })['timer.countdown']).toBeDefined();
    expect(validateTimer({ ...base, pomodoro: { ...base.pomodoro, workMs: 181 * MIN } })['timer.workMs']).toBeDefined();
    expect(validateTimer({ ...base, pomodoro: { ...base.pomodoro, sessionsBeforeLongBreak: 2.5 } })['timer.sessions']).toBeDefined();
  });
});

describe('saveDraft', () => {
  it('applies edits atomically without touching a running timer', () => {
    const d = must(timerCommand(dataWith('a'), 'start', T0)).data;
    const a = d.tasks[0];
    const edit: TaskEdit = { id: 'a', name: 'renamed', finishCondition: a.finishCondition, priority: 'high', estimateMs: null, timer: a.timer };
    const r = must(saveDraft(d, { tasks: [edit], settings: null }, T0 + MIN));
    expect(r.data.tasks[0].name).toBe('renamed');
    expect(r.data.tasks[0].runtime).toEqual(a.runtime);
    const locked = saveDraft(d, { tasks: [{ ...edit, finishCondition: 'something else entirely' }], settings: null }, T0);
    expect(locked.ok).toBe(false);
    const timerWhileRunning = saveDraft(d, { tasks: [{ ...edit, timer: { ...a.timer, mode: 'stopwatch' } }], settings: null }, T0);
    expect(timerWhileRunning.ok).toBe(false);
  });
});
