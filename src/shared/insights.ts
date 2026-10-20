// Read-only metrics for the Done tab, computed from the daily record, the
// journal and the current tasks. Pure, with an explicit `now`, so the renderer
// can recompute them every second and the tests can pin every number.

import { addDays, dayKey, startOfDay, startOfWeek } from './format';
import { focusBetween, liveWorkSlice } from './record';
import type { AppData, JournalEntry, Task } from './types';

type Data = Omit<AppData, 'windowPos'>;
const HOUR = 3_600_000;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function weekStarts(now: number): number[] {
  const w = startOfWeek(now);
  return Array.from({ length: 7 }, (_, i) => addDays(w, i));
}

export interface WeekSummary {
  started: number;
  finished: number;
  fully: number;
  dropped: number;
}

export function weekSummary(data: Data, now: number): WeekSummary {
  const keys = weekStarts(now).map(dayKey);
  const sum = (f: 'started' | 'finished' | 'dropped') => keys.reduce((s, k) => s + (data.days[k]?.[f] ?? 0), 0);
  const from = startOfWeek(now);
  const fully = data.journal.filter((j) => j.at >= from && j.grade === 'fully').length;
  return { started: sum('started'), finished: sum('finished'), fully, dropped: sum('dropped') };
}

/** Total tracked work of every finished task, kept even if the task is deleted. */
export function banked(journal: JournalEntry[]): number {
  return journal.reduce((s, j) => s + j.trackedMs, 0);
}

/**
 * Work sunk into tasks dropped for lost focus (until they are finished, even while
 * active again), plus unfinished work that was deleted.
 */
export function orphaned(data: Pick<AppData, 'tasks' | 'orphanedDeletedMs'>): number {
  return data.tasks.filter((t) => t.status !== 'completed' && t.lostFocusDrops > 0).reduce((s, t) => s + t.workMs, 0) + data.orphanedDeletedMs;
}

/** Lifetime focus per calendar day (zero days and weekends included) and the 7-day average. */
export function lifetimeAverage(data: Data, now: number): { perDay: number; last7: number } | null {
  const focusDays = Object.keys(data.days).filter((k) => data.days[k].focusMs > 0).sort();
  const live = liveWorkSlice(data.tasks, now);
  const first = focusDays.length ? parseKey(focusDays[0]) : live ? startOfDay(live.start) : null;
  if (first === null) return null;
  const tomorrow = addDays(now, 1);
  const total = focusBetween(data, first, tomorrow, now);
  let span = 0;
  for (let t = first; t < tomorrow; t = addDays(t, 1)) span++;
  return { perDay: total / span, last7: focusBetween(data, addDays(now, -6), tomorrow, now) / 7 };
}

function parseKey(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export interface Calibration {
  ratio: number;
  n: number;
}

/** Median of actual/estimate over finished tasks with estimates; needs at least 3. */
export function calibration(journal: JournalEntry[]): Calibration | null {
  const rs = journal.filter((j) => j.estimateMs && j.estimateMs > 0 && j.trackedMs > 0).map((j) => j.trackedMs / j.estimateMs!);
  const ratio = rs.length >= 3 ? median(rs) : null;
  return ratio === null ? null : { ratio, n: rs.length };
}

export function calibrationText(c: Calibration): string {
  if (Math.abs(c.ratio - 1) <= 0.1) return 'Your estimates are accurate.';
  const pct = Math.round(Math.abs(c.ratio - 1) * 100);
  return `Your estimates run ${pct}% ${c.ratio > 1 ? 'short' : 'long'} - multiply by ${c.ratio.toFixed(1)}.`;
}

/** Average wait between a task becoming active and its first Start, for tasks first started this week. */
export function startLatencyWeek(tasks: Task[], now: number): number | null {
  const from = startOfWeek(now);
  const xs = tasks.filter((t) => t.startedAt !== null && t.startedAt >= from && t.startLatencyMs !== null).map((t) => t.startLatencyMs!);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function medianStretch(tasks: Task[]): number | null {
  return median(tasks.flatMap((t) => t.sessions.filter((s) => s.kind === 'work' && s.ms > 0).map((s) => s.ms)));
}

export interface IndexPart {
  key: 'completion' | 'depth' | 'accuracy' | 'consistency' | 'fragmentation';
  label: string;
  weight: number;
  /** Shrunk value, 0-1. */
  value: number;
  raw: number;
}

export type FocusIndex =
  | { ready: false; tasks: number; days: number }
  | { ready: true; score: number; confidence: 'low' | 'medium' | 'high'; parts: IndexPart[]; sentence: string };

/**
 * Focus Index, 0-100. Five parts, each shrunk toward 0.5 by 5/(n+5) so a
 * handful of tasks cannot produce an extreme score. Hidden until there are
 * 3 finished tasks and 3 days with focus.
 */
export function focusIndex(data: Data, now: number): FocusIndex {
  const n = data.journal.length;
  const days = Object.values(data.days);
  const activeDays = days.filter((d) => d.focusMs > 0).length;
  if (n < 3 || activeDays < 3) return { ready: false, tasks: Math.min(n, 3), days: Math.min(activeDays, 3) };

  const started = days.reduce((s, d) => s + d.started, 0) || n;
  const fully = data.journal.filter((j) => j.grade === 'fully').length;
  const mostly = data.journal.filter((j) => j.grade === 'mostly' || j.grade === null).length;
  const completion = clamp01((fully + 0.5 * mostly) / started);

  const focus = days.reduce((s, d) => s + d.focusMs, 0);
  const deep = days.reduce((s, d) => s + d.deepMs, 0);
  const depth = focus > 0 ? clamp01(deep / focus) : 0.5;

  const fits = data.journal.filter((j) => j.estimateMs && j.estimateMs > 0 && j.trackedMs > 0).map((j) => Math.min(j.trackedMs, j.estimateMs!) / Math.max(j.trackedMs, j.estimateMs!));
  const accuracy = median(fits) ?? 0.5;

  let active14 = 0;
  for (let i = 0; i < 14; i++) {
    const day = addDays(now, -i);
    if (focusBetween(data, day, addDays(day, 1), now) > 0) active14++;
  }
  const consistency = active14 / 14;

  const pauses = days.reduce((s, d) => s + d.pauses, 0);
  const perHour = focus > 0 ? pauses / (focus / HOUR) : 0;
  const fragmentation = 1 - clamp01(perHour / 6);

  const w = 5 / (n + 5);
  const shrink = (v: number) => w * 0.5 + (1 - w) * v;
  const parts: IndexPart[] = [
    { key: 'completion', label: 'Completion', weight: 0.35, value: shrink(completion), raw: completion },
    { key: 'depth', label: 'Depth', weight: 0.25, value: shrink(depth), raw: depth },
    { key: 'accuracy', label: 'Estimates', weight: 0.15, value: shrink(accuracy), raw: accuracy },
    { key: 'consistency', label: 'Consistency', weight: 0.15, value: shrink(consistency), raw: consistency },
    { key: 'fragmentation', label: 'Few pauses', weight: 0.1, value: shrink(fragmentation), raw: fragmentation },
  ];
  const score = Math.round(100 * parts.reduce((s, p) => s + p.weight * p.value, 0));
  const confidence = n < 10 ? 'low' : n < 30 ? 'medium' : 'high';
  const weakest = parts.reduce((a, b) => (b.value < a.value ? b : a));

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const stretch = medianStretch(data.tasks);
  const sentence = {
    completion: `You fully finished ${fully} of ${started} tasks you started.`,
    depth: stretch !== null ? `Your median stretch is ${Math.round(stretch / 60_000)} min.` : `${pct(depth)} of your focus comes in stretches of 15 min or more.`,
    accuracy: fits.length ? `Your median estimate is off by ${Math.round((1 / Math.max(accuracy, 0.01) - 1) * 100)}%.` : 'Add estimates to your tasks to measure accuracy.',
    consistency: `You focused on ${active14} of the last 14 days.`,
    fragmentation: `You pause about ${perHour.toFixed(1)} times per focus hour.`,
  }[weakest.key];
  return { ready: true, score: Math.min(100, Math.max(0, score)), confidence, parts, sentence };
}

export interface HeatCell {
  key: string;
  date: number;
  ms: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/** The last 20 weeks as Mon-Sun columns (a fixed width reads as a calendar even with little data). */
export function heatmap(data: Data, now: number): { weeks: HeatCell[][]; bestDayMs: number } {
  const bestDayMs = Math.max(0, ...Object.values(data.days).map((d) => d.focusMs));
  const thisWeek = startOfWeek(now);
  const weeks: HeatCell[][] = [];
  for (let w = addDays(thisWeek, -7 * 19); w <= thisWeek; w = addDays(w, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(w, i);
        const key = dayKey(date);
        const ms = date === startOfDay(now) ? focusBetween(data, date, addDays(date, 1), now) : data.days[key]?.focusMs ?? 0;
        const level = ms <= 0 || bestDayMs <= 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((4 * ms) / bestDayMs))) as HeatCell['level']);
        return { key, date, ms, level, future: date > now };
      }),
    );
  }
  return { weeks, bestDayMs };
}
