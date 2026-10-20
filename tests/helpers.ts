// Test fixtures: build tasks and app data with a fixed clock.
import { addTask, emptyData } from '../src/shared/tasks';
import { createTask, defaultSettings } from '../src/shared/tasks';
import type { AppData, Task, TimerConfig } from '../src/shared/types';

export const T0 = Date.UTC(2026, 9, 20, 9, 0, 0);
export const SEC = 1000;
export const MIN = 60_000;

export function makeTask(timer: Partial<TimerConfig> & { mode: TimerConfig['mode'] }, id = 't1'): Task {
  const s = defaultSettings();
  const cfg: TimerConfig = { ...s.defaultTimer, ...timer };
  return { ...createTask({ name: id, finishCondition: 'Finished when tests pass' }, s, T0, id), timer: cfg, status: 'active' };
}

export function dataWith(...names: string[]): AppData {
  let d = emptyData();
  for (const n of names) {
    const r = addTask(d, { name: n, finishCondition: `Done when ${n} is shipped` }, T0, n);
    if (!r.ok) throw new Error(r.error);
    d = r.data;
  }
  return d;
}

export function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}
