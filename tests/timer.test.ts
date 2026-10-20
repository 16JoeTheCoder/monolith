// Timer engine: countdown, stopwatch, pomodoro, and clock edge cases.
import { describe, expect, it } from 'vitest';
import { advance, display, pause, reset, skipPhase, start } from '../src/shared/timer';
import { defaultTimer } from '../src/shared/tasks';
import { MIN, SEC, T0, makeTask } from './helpers';

const countdown = (ms: number, onExpire: 'stop' | 'continue' = 'stop') => makeTask({ mode: 'countdown', countdown: { durationMs: ms, onExpire } });
const pomo = (over: Partial<ReturnType<typeof defaultTimer>['pomodoro']> = {}) =>
  makeTask({ mode: 'pomodoro', pomodoro: { ...defaultTimer().pomodoro, workMs: 10 * MIN, shortBreakMs: 2 * MIN, longBreakMs: 5 * MIN, sessionsBeforeLongBreak: 2, ...over } });

describe('countdown', () => {
  it('stops exactly at expiry and never goes negative', () => {
    const t = start(countdown(5 * MIN), T0);
    const res = advance(t, T0 + 7 * MIN);
    expect(res.events).toHaveLength(1);
    expect(res.task.runtime.status).toBe('completed');
    expect(res.task.workMs).toBe(5 * MIN);
    const d = display(res.task, T0 + 9 * MIN);
    expect(d.remaining).toBe(0);
    expect(d.expired).toBe(true);
  });

  it('pauses and resumes from timestamps', () => {
    let t = start(countdown(10 * MIN), T0);
    t = pause(t, T0 + 2 * MIN).task;
    expect(display(t, T0 + 30 * MIN).remaining).toBe(8 * MIN);
    t = start(t, T0 + 30 * MIN);
    expect(display(t, T0 + 31 * MIN).remaining).toBe(7 * MIN);
    expect(t.sessions).toHaveLength(1);
  });

  it('reset zeroes the display but keeps totals and sessions', () => {
    let t = start(countdown(10 * MIN), T0);
    t = reset(t, T0 + 3 * MIN);
    expect(t.runtime.status).toBe('idle');
    expect(display(t, T0 + 5 * MIN).remaining).toBe(10 * MIN);
    expect(t.workMs).toBe(3 * MIN);
    expect(t.sessions).toHaveLength(1);
  });

  it('continues into overtime and notifies once', () => {
    let t = start(countdown(1 * MIN, 'continue'), T0);
    const a = advance(t, T0 + 2 * MIN);
    expect(a.events).toHaveLength(1);
    t = a.task;
    expect(advance(t, T0 + 3 * MIN).events).toHaveLength(0);
    const d = display(t, T0 + 3 * MIN);
    expect(d.status).toBe('running');
    expect(d.remaining).toBe(0);
    expect(d.overtime).toBe(2 * MIN);
  });
});

describe('stopwatch', () => {
  it('reports elapsed and progress against the estimate', () => {
    const t = start({ ...makeTask({ mode: 'stopwatch' }), estimateMs: 20 * MIN }, T0);
    const d = display(t, T0 + 5 * MIN);
    expect(d.elapsed).toBe(5 * MIN);
    expect(d.remaining).toBeNull();
    expect(d.progress).toBeCloseTo(0.25);
    expect(display({ ...t, estimateMs: null }, T0 + 5 * MIN, null).progress).toBeNull();
  });
});

describe('pomodoro', () => {
  it('waits at the next phase when auto-start is off, closing the slice at the exact boundary', () => {
    const t = start(pomo(), T0);
    const r = advance(t, T0 + 13 * MIN);
    expect(r.task.runtime.phase).toBe('shortBreak');
    expect(r.task.runtime.status).toBe('idle');
    expect(r.task.workMs).toBe(10 * MIN);
    expect(r.task.pomodorosCompleted).toBe(1);
  });

  it('auto-starts through several phases and schedules the long break', () => {
    const t = start(pomo({ autoStartBreaks: true, autoStartWork: true }), T0);
    // work 10, short 2, work 10 -> long break starts at 22
    const r = advance(t, T0 + 23 * MIN);
    expect(r.task.runtime.phase).toBe('longBreak');
    expect(r.task.runtime.cycleSessions).toBe(0);
    expect(r.task.pomodorosCompleted).toBe(2);
    expect(r.task.workMs).toBe(20 * MIN);
    expect(r.task.breakMs).toBe(2 * MIN);
    expect(r.events.map((e) => e.to)).toEqual(['shortBreak', 'work', 'longBreak']);
    const d = display(r.task, T0 + 23 * MIN);
    expect(d.breakMs).toBe(3 * MIN);
    expect(d.workMs).toBe(20 * MIN); // break time never counts as work
  });

  it('skipping work gives no credit and follows auto-start rules', () => {
    const t = start(pomo({ autoStartBreaks: true }), T0);
    const r = skipPhase(t, T0 + 4 * MIN);
    expect(r.task.pomodorosCompleted).toBe(0);
    expect(r.task.runtime.phase).toBe('shortBreak');
    expect(r.task.runtime.status).toBe('running');
    expect(r.task.workMs).toBe(4 * MIN);
    const r2 = skipPhase(r.task, T0 + 5 * MIN);
    expect(r2.task.runtime.phase).toBe('work');
    expect(r2.task.runtime.status).toBe('idle');
    expect(r2.task.breakMs).toBe(1 * MIN);
  });
});

describe('clock moving backwards', () => {
  it('never yields negative time', () => {
    const t = start(countdown(10 * MIN), T0);
    const d = display(t, T0 - 5 * MIN);
    expect(d.elapsed).toBe(0);
    expect(d.remaining).toBe(10 * MIN);
    const p = pause(t, T0 - 5 * MIN).task;
    expect(p.workMs).toBe(0);
    expect(p.runtime.phaseElapsedMs).toBeGreaterThanOrEqual(0);
    expect(display(p, T0 + SEC).elapsed).toBe(0);
  });
});
