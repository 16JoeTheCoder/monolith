// The daily record: per local day focus time (split by hour), deep time,
// pauses and started/finished/dropped counts. It lives beside the tasks, not
// inside them, so deleting a task never rewrites history.
//
// Work time enters the record in exactly one place, recordWork(), which diffs
// two AppData states and books every newly closed work session. Every path that
// closes a slice (pause, finish, drop, phase boundary, gap answer, sleep) goes
// through the controller, which calls it, so nothing is counted twice or missed.

import { addDays, dayKey, startOfDay } from './format';
import type { AppData, DayRecord, Session, Task } from './types';

export const DEEP_MS = 15 * 60_000;
const HOUR = 3_600_000;

export function emptyDay(): DayRecord {
  return { focusMs: 0, deepMs: 0, pauses: 0, started: 0, finished: 0, dropped: 0, byHour: new Array(24).fill(0) };
}

type Days = Record<string, DayRecord>;

/** Add one work stretch, split at local hour (and therefore midnight) boundaries. */
export function addWork(days: Days, start: number, end: number, deep: boolean): Days {
  const out = { ...days };
  let t = start;
  while (t < end) {
    const d = new Date(t);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const segEnd = Math.min(end, nextHour > t ? nextHour : t + HOUR);
    const ms = segEnd - t;
    const key = dayKey(t);
    const rec = out[key] ?? emptyDay();
    const byHour = rec.byHour.slice();
    byHour[d.getHours()] += ms;
    out[key] = { ...rec, focusMs: rec.focusMs + ms, deepMs: rec.deepMs + (deep ? ms : 0), byHour };
    t = segEnd;
  }
  return out;
}

export function bumpDay(days: Days, at: number, field: 'pauses' | 'started' | 'finished' | 'dropped'): Days {
  const key = dayKey(at);
  const rec = days[key] ?? emptyDay();
  return { ...days, [key]: { ...rec, [field]: rec[field] + 1 } };
}

/** Sessions present in `next` but not in `prev` (sessions are append-only per task). */
function newSessions(prev: Task | undefined, next: Task): Session[] {
  const old = prev?.sessions ?? [];
  if (old.length === 0) return next.sessions;
  const last = old[old.length - 1];
  const i = next.sessions.findIndex((s) => s.startedAt === last.startedAt && s.endedAt === last.endedAt);
  return i >= 0 ? next.sessions.slice(i + 1) : [];
}

/** Book every work session closed between `prev` and `next` into the daily record and bests. */
export function recordWork(prev: AppData, next: AppData): AppData {
  if (prev.tasks === next.tasks) return next;
  const before = new Map(prev.tasks.map((t) => [t.id, t]));
  let days = next.days;
  let longest = next.bests.longestStretchMs;
  for (const t of next.tasks) {
    for (const s of newSessions(before.get(t.id), t)) {
      if (s.kind !== 'work' || s.ms <= 0) continue;
      days = addWork(days, s.startedAt, s.endedAt, s.ms >= DEEP_MS);
      longest = Math.max(longest, s.ms);
    }
  }
  if (days === next.days && longest === next.bests.longestStretchMs) return next;
  return { ...next, days, bests: { longestStretchMs: longest } };
}

/** The running work slice of the active task, if any (breaks are not focus). */
export function liveWorkSlice(tasks: Task[], now: number): { start: number; end: number } | null {
  const t = tasks.find((x) => x.status === 'active');
  const rt = t?.runtime;
  if (!t || !rt || rt.sliceStartedAt === null) return null;
  if (t.timer.mode === 'pomodoro' && rt.phase !== 'work') return null;
  return { start: rt.sliceStartedAt, end: Math.max(rt.sliceStartedAt, now) };
}

/** Focus time in [from, to) from the record plus the live slice. `from`/`to` are local midnights. */
export function focusBetween(data: Pick<AppData, 'days' | 'tasks'>, from: number, to: number, now: number): number {
  let total = 0;
  for (let t = from; t < to; t = addDays(t, 1)) total += data.days[dayKey(t)]?.focusMs ?? 0;
  const live = liveWorkSlice(data.tasks, now);
  if (live) total += Math.max(0, Math.min(live.end, to) - Math.max(live.start, from));
  return total;
}

/** "Today: 2h 14m focused" — every task, including the running slice. */
export function focusToday(data: Pick<AppData, 'days' | 'tasks'>, now: number): number {
  const day = startOfDay(now);
  return focusBetween(data, day, addDays(day, 1), now);
}
