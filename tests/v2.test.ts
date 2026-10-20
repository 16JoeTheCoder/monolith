// 0.2 features: v1 migration, daily record, banked/orphaned/chain, Focus Index,
// calibration, start latency, lifetime average, appearance limits, Today figure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/main/store';
import { dayKey } from '../src/shared/format';
import {
  banked, calibration, calibrationText, focusIndex, lifetimeAverage, orphaned, startLatencyWeek,
} from '../src/shared/insights';
import { addWork, emptyDay, focusToday, recordWork } from '../src/shared/record';
import {
  completeTask, defaultSettings, defaultTimer, deleteTask, dropTask, emptyData, saveDraft, timerCommand, type Mutation,
} from '../src/shared/tasks';
import { idleRuntime } from '../src/shared/timer';
import type { AppData, JournalEntry } from '../src/shared/types';
import { validateSettings } from '../src/shared/validation';
import { MIN, T0, dataWith, must } from './helpers';

const HOUR = 60 * MIN;
const PHRASE = 'I have finished this task';
/** Local time on 20 Oct 2026 (a Tuesday), so day keys do not depend on the machine's zone. */
const L = (h: number, m = 0, day = 20) => new Date(2026, 9, day, h, m).getTime();
const step = (d: AppData, r: Mutation) => recordWork(d, must(r).data);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-v2-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('v1 -> v2 migration', () => {
  it('backs up, drops money/notes/deadline, keeps history, backfills record and journal', () => {
    const v1 = {
      version: 1,
      tasks: [
        {
          id: 'a', name: 'Old', notes: 'n', finishCondition: 'Done when shipped', priority: 'high', value: 50, valueIsEarned: true,
          deadline: '2026-10-30T00:00:00.000Z', estimateMs: 20 * MIN, status: 'completed', timer: defaultTimer(), runtime: idleRuntime(),
          workMs: 30 * MIN, breakMs: 0, pomodorosCompleted: 0,
          sessions: [{ startedAt: L(9), endedAt: L(9, 30), ms: 30 * MIN, kind: 'work' }],
          createdAt: L(8, 50), startedAt: L(9), completedAt: L(9, 30), droppedCount: 0,
        },
        {
          id: 'b', name: 'Current', notes: '', finishCondition: 'Done when merged', priority: 'none', value: 0, valueIsEarned: false,
          deadline: null, estimateMs: null, status: 'active', timer: defaultTimer(), runtime: { ...idleRuntime(), status: 'paused', phaseElapsedMs: 5 * MIN },
          workMs: 5 * MIN, breakMs: 0, pomodorosCompleted: 0,
          sessions: [{ startedAt: L(10), endedAt: L(10, 5), ms: 5 * MIN, kind: 'work' }],
          createdAt: L(9, 40), startedAt: L(10), completedAt: null, droppedCount: 1,
        },
      ],
      settings: { ...defaultSettings(), idleOpacity: 0.7, currency: 'USD', showMoneyInCompact: true },
      windowPos: { x: 5, y: 6 },
      events: [
        { type: 'started', taskId: 'a', at: L(9) },
        { type: 'finished', taskId: 'a', at: L(9, 30) },
        { type: 'started', taskId: 'b', at: L(10) },
      ],
    };
    const store = new Store(dir);
    fs.writeFileSync(store.file, JSON.stringify(v1));
    const d = store.load(L(11));

    expect(JSON.parse(fs.readFileSync(store.v1Backup, 'utf8'))).toEqual(v1);
    expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).version).toBe(2);
    expect(d.version).toBe(2);
    const a = d.tasks.find((t) => t.id === 'a')!;
    for (const gone of ['value', 'valueIsEarned', 'notes', 'deadline']) expect(a).not.toHaveProperty(gone);
    expect(d.settings).not.toHaveProperty('currency');
    expect(d.settings).not.toHaveProperty('showMoneyInCompact');
    expect(d.settings.idleOpacity).toBe(0.7);
    expect(a.workMs).toBe(30 * MIN);
    expect(a.sessions).toHaveLength(1);
    expect(a.activatedAt).toBe(a.createdAt);
    expect(a.lostFocusDrops).toBe(0);
    expect(d.windowPos).toEqual({ x: 5, y: 6 });
    expect(d.events).toHaveLength(3);

    const day = d.days[dayKey(L(9))];
    expect(day.focusMs).toBe(35 * MIN);
    expect(day.deepMs).toBe(30 * MIN);
    expect(day.started).toBe(2);
    expect(day.finished).toBe(1);
    expect(day.byHour[9]).toBe(30 * MIN);
    expect(d.journal).toEqual([{ at: L(9, 30), taskId: 'a', trackedMs: 30 * MIN, estimateMs: 20 * MIN, startLatencyMs: 10 * MIN, grade: null, clean: true }]);
    expect(d.chain).toEqual({ current: 1, best: 1 });
    expect(d.bests.longestStretchMs).toBe(30 * MIN);

    // Second load is plain v2 and the backup is not overwritten.
    fs.writeFileSync(store.v1Backup, 'keep');
    expect(store.load(L(12)).tasks).toHaveLength(2);
    expect(fs.readFileSync(store.v1Backup, 'utf8')).toBe('keep');
  });
});

describe('daily record', () => {
  it('splits work across hour and midnight boundaries', () => {
    let days = addWork({}, L(9, 50), L(10, 10), false);
    expect(days[dayKey(L(9))].byHour[9]).toBe(10 * MIN);
    expect(days[dayKey(L(9))].byHour[10]).toBe(10 * MIN);
    expect(days[dayKey(L(9))].deepMs).toBe(0);
    days = addWork({}, L(23, 30), L(0, 45, 21), true);
    expect(days['2026-10-20'].focusMs).toBe(30 * MIN);
    expect(days['2026-10-20'].byHour[23]).toBe(30 * MIN);
    expect(days['2026-10-21'].focusMs).toBe(45 * MIN);
    expect(days['2026-10-21'].byHour[0]).toBe(45 * MIN);
    expect(days['2026-10-21'].deepMs).toBe(45 * MIN);
  });

  it('books closed slices once, counts user pauses, and survives deletion', () => {
    let d = dataWith('a', 'b');
    d = step(d, timerCommand(d, 'start', L(9)));
    d = step(d, timerCommand(d, 'pause', L(9, 20)));
    d = step(d, timerCommand(d, 'start', L(9, 30)));
    d = step(d, timerCommand(d, 'pause', L(9, 33))); // before the 25-min countdown ends
    const day = d.days[dayKey(L(9))];
    expect(day.focusMs).toBe(23 * MIN);
    expect(day.deepMs).toBe(20 * MIN);
    expect(day.pauses).toBe(2);
    expect(day.started).toBe(1);
    d = step(d, deleteTask(d, 'a', true, L(10)));
    expect(d.days[dayKey(L(9))].focusMs).toBe(23 * MIN);
    expect(d.orphanedDeletedMs).toBe(23 * MIN);
  });

  it('Today includes every task and the live running slice', () => {
    let d = dataWith('a');
    d = { ...d, days: { [dayKey(L(9))]: { ...emptyDay(), focusMs: 30 * MIN } } };
    d = step(d, timerCommand(d, 'start', L(10)));
    expect(focusToday(d, L(10, 10))).toBe(40 * MIN);
    // A slice that began yesterday only counts from midnight.
    let y = dataWith('b');
    y = step(y, timerCommand(y, 'start', L(23, 50, 19)));
    expect(focusToday(y, L(0, 10))).toBe(10 * MIN);
  });
});

describe('banked, orphaned and chain', () => {
  it('follows the drop kinds, the 10-minute rule and un-orphans on finish', () => {
    let d = dataWith('a', 'b', 'c');
    d = step(d, timerCommand(d, 'start', L(9)));
    d = step(d, dropTask(d, 'a', 'phone', 'lostFocus', L(9, 12)));
    expect(orphaned(d)).toBe(12 * MIN);
    expect(d.tasks.find((t) => t.id === 'a')!.lostFocusDrops).toBe(1);

    d = step(d, timerCommand(d, 'start', L(10)));
    d = step(d, completeTask(d, 'b', PHRASE, 'fully', L(10, 11)));
    expect(d.chain).toEqual({ current: 1, best: 1 });
    expect(banked(d.journal)).toBe(11 * MIN);

    d = step(d, timerCommand(d, 'start', L(11)));
    d = step(d, dropTask(d, 'c', 'waiting on the API', 'blocked', L(11, 5)));
    expect(d.chain.current).toBe(1); // blocked: no penalty
    expect(orphaned(d)).toBe(12 * MIN);
    expect(d.days[dayKey(L(9))].dropped).toBe(2);

    d = step(d, timerCommand(d, 'start', L(12)));
    d = step(d, completeTask(d, 'a', PHRASE, 'mostly', L(12, 5)));
    expect(orphaned(d)).toBe(0); // finished later: no longer orphaned
    expect(d.chain).toEqual({ current: 2, best: 2 });
    expect(d.journal.at(-1)).toMatchObject({ taskId: 'a', trackedMs: 17 * MIN, grade: 'mostly', clean: false });

    d = step(d, timerCommand(d, 'start', L(13)));
    d = step(d, completeTask(d, 'c', PHRASE, 'fully', L(13, 4)));
    expect(d.chain.current).toBe(2); // 9 min total: under 10, does not count
    expect(banked(d.journal)).toBe((11 + 17 + 9) * MIN);
  });

  it('a lost-focus drop resets the chain; grades are required', () => {
    let d = dataWith('a', 'b', 'c');
    d = { ...d, chain: { current: 4, best: 6 } };
    d = step(d, dropTask(d, 'a', 'bored now', 'lostFocus', L(9)));
    expect(d.chain).toEqual({ current: 0, best: 6 });
    expect(completeTask(d, 'b', PHRASE, 'great' as never, L(9)).ok).toBe(false);
  });
});

function profile(n: number, good: boolean, now: number): AppData {
  const d = emptyData();
  const activeDays = good ? 14 : 3;
  for (let i = 0; i < activeDays; i++) {
    d.days[dayKey(now - i * 24 * HOUR)] = { ...emptyDay(), focusMs: HOUR, deepMs: good ? HOUR : 0, pauses: good ? 0 : 20, started: i === 0 ? n : 0 };
  }
  d.journal = Array.from({ length: n }, (_, i): JournalEntry => ({
    at: now - i, taskId: `t${i}`, trackedMs: 30 * MIN, estimateMs: good ? 30 * MIN : 3 * MIN, startLatencyMs: 0, grade: good ? 'fully' : 'barely', clean: true,
  }));
  return d;
}

describe('Focus Index', () => {
  const now = L(15);
  it('is gated until 3 finished tasks and 3 active days', () => {
    expect(focusIndex(emptyData(), now)).toEqual({ ready: false, tasks: 0, days: 0 });
    const two = profile(2, true, now);
    expect(focusIndex(two, now)).toMatchObject({ ready: false, tasks: 2, days: 3 });
  });

  it('stays in 0-100 and shrinks small samples toward the middle', () => {
    const small = focusIndex(profile(3, true, now), now);
    const big = focusIndex(profile(300, true, now), now);
    const bad = focusIndex(profile(300, false, now), now);
    if (!small.ready || !big.ready || !bad.ready) throw new Error('should be ready');
    expect(small.score).toBe(69); // every part perfect, shrunk by 5/8
    expect(big.score).toBe(99);
    expect(bad.score).toBeGreaterThanOrEqual(0);
    expect(bad.score).toBeLessThan(20);
    expect(small.confidence).toBe('low');
    expect(big.confidence).toBe('high');
    expect(focusIndex(profile(12, true, now), now)).toMatchObject({ confidence: 'medium' });
    expect(bad.sentence).toMatch(/\d/);
  });
});

describe('calibration, latency, lifetime average', () => {
  const entry = (tracked: number, est: number | null): JournalEntry => ({ at: 0, taskId: 'x', trackedMs: tracked, estimateMs: est, startLatencyMs: 0, grade: 'fully', clean: true });

  it('needs 3 estimated finishes and reports the median multiplier', () => {
    expect(calibration([entry(30, 20), entry(28, 20)])).toBeNull();
    const c = calibration([entry(30, 20), entry(28, 20), entry(32, 20), entry(5, null)])!;
    expect(c.ratio).toBeCloseTo(1.5);
    expect(calibrationText(c)).toBe('Your estimates run 50% short - multiply by 1.5.');
    expect(calibrationText(calibration([entry(10, 20), entry(10, 20), entry(10, 20)])!)).toBe('Your estimates run 50% long - multiply by 0.5.');
    expect(calibrationText(calibration([entry(21, 20), entry(19, 20), entry(20, 20)])!)).toBe('Your estimates are accurate.');
  });

  it('measures start latency from activation to first Start', () => {
    let d = dataWith('a', 'b');
    d = step(d, timerCommand(d, 'start', T0 + 4 * MIN));
    d = step(d, completeTask(d, 'a', PHRASE, 'fully', T0 + 10 * MIN));
    d = step(d, timerCommand(d, 'start', T0 + 12 * MIN));
    expect(d.tasks.find((t) => t.id === 'a')!.startLatencyMs).toBe(4 * MIN);
    expect(d.tasks.find((t) => t.id === 'b')!.startLatencyMs).toBe(2 * MIN);
    expect(startLatencyWeek(d.tasks, T0 + 13 * MIN)).toBe(3 * MIN);
  });

  it('averages lifetime focus over every calendar day, zero days included', () => {
    const d = emptyData();
    d.days[dayKey(L(9, 0, 17))] = { ...emptyDay(), focusMs: 3 * HOUR };
    const avg = lifetimeAverage(d, L(12))!;
    expect(avg.perDay).toBe(45 * MIN); // 17th..20th = 4 days
    expect(avg.last7).toBeCloseTo((3 * HOUR) / 7);
    expect(lifetimeAverage(emptyData(), L(12))).toBeNull();
  });
});

describe('appearance settings', () => {
  it('accepts opacity 0% and 100%', () => {
    expect(validateSettings({ ...defaultSettings(), idleOpacity: 0 })).toEqual({});
    expect(validateSettings({ ...defaultSettings(), idleOpacity: 1 })).toEqual({});
    const d = dataWith('a');
    expect(must(saveDraft(d, { tasks: [], settings: { ...d.settings, idleOpacity: 0 } }, T0)).data.settings.idleOpacity).toBe(0);
  });

  it('clamps font and bar sizes', () => {
    const d = dataWith('a');
    const s = { ...d.settings, appearance: { statusPx: 3, titlePx: 99, digitsPx: 40, barPx: 1 } };
    expect(must(saveDraft(d, { tasks: [], settings: s }, T0)).data.settings.appearance).toEqual({ statusPx: 9, titlePx: 28, digitsPx: 40, barPx: 2 });
  });
});
