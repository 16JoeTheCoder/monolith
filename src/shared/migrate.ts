// Turning stored JSON into a valid AppData v2. v1 files (Monolith 0.1) are
// migrated: money, notes and deadline are dropped, everything else is kept, and
// the daily record and journal are rebuilt from the sessions and events v1
// already stored. Pure; the store handles the files and the one-time backup.

import { addWork, bumpDay, DEEP_MS } from './record';
import { CHAIN_MIN_MS, defaultSettings, emptyData } from './tasks';
import { idleRuntime } from './timer';
import type { AppData, AppEvent, JournalEntry, Settings, Task } from './types';
import { validateSettings } from './validation';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Fill missing settings from defaults; an invalid stored set falls back to defaults. */
export function mergeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const r = raw as Partial<Settings>;
  const merged: Settings = {
    defaultTimer: r.defaultTimer ?? d.defaultTimer,
    idleOpacity: num(r.idleOpacity, d.idleOpacity),
    soundEnabled: r.soundEnabled ?? d.soundEnabled,
    notificationsEnabled: r.notificationsEnabled ?? d.notificationsEnabled,
    launchAtStartup: r.launchAtStartup ?? d.launchAtStartup,
    shortcutsEnabled: r.shortcutsEnabled ?? d.shortcutsEnabled,
    shortcuts: { ...d.shortcuts, ...r.shortcuts },
    appearance: { ...d.appearance, ...r.appearance },
    theme: r.theme ?? d.theme,
    accent: r.accent ?? d.accent,
    onboarded: r.onboarded ?? d.onboarded,
  };
  return Object.keys(validateSettings(merged)).length ? d : merged;
}

function toTask(raw: Raw): Task | null {
  if (typeof raw.id !== 'string' || !isObj(raw.timer) || !isObj(raw.runtime)) return null;
  const createdAt = num(raw.createdAt, 0);
  const startedAt = numOrNull(raw.startedAt);
  return {
    id: raw.id,
    name: String(raw.name ?? ''),
    finishCondition: String(raw.finishCondition ?? ''),
    priority: (['none', 'low', 'medium', 'high'].includes(raw.priority as string) ? raw.priority : 'none') as Task['priority'],
    estimateMs: numOrNull(raw.estimateMs),
    status: (['queued', 'active', 'completed'].includes(raw.status as string) ? raw.status : 'queued') as Task['status'],
    timer: raw.timer as unknown as Task['timer'],
    runtime: { ...idleRuntime(), ...(raw.runtime as object) },
    workMs: num(raw.workMs, 0),
    breakMs: num(raw.breakMs, 0),
    pomodorosCompleted: num(raw.pomodorosCompleted, 0),
    sessions: Array.isArray(raw.sessions) ? (raw.sessions as Task['sessions']) : [],
    createdAt,
    activatedAt: raw.activatedAt === undefined ? createdAt : numOrNull(raw.activatedAt),
    startedAt,
    startLatencyMs: raw.startLatencyMs === undefined ? (startedAt !== null ? Math.max(0, startedAt - createdAt) : null) : numOrNull(raw.startLatencyMs),
    completedAt: numOrNull(raw.completedAt),
    droppedCount: num(raw.droppedCount, 0),
    lostFocusDrops: num(raw.lostFocusDrops, 0),
  };
}

function windowPos(v: unknown): AppData['windowPos'] {
  return isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x as number, y: v.y as number } : null;
}

/** v1 -> v2. Keeps every task, session, total and event. */
export function migrateV1(raw: Raw): AppData {
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).filter(isObj).map(toTask).filter((t): t is Task => t !== null);
  const events = (Array.isArray(raw.events) ? raw.events : []).filter(isObj) as unknown as AppEvent[];

  let days: AppData['days'] = {};
  let longest = 0;
  for (const t of tasks) {
    for (const s of t.sessions) {
      if (s.kind !== 'work' || !(s.ms > 0)) continue;
      days = addWork(days, s.startedAt, s.endedAt, s.ms >= DEEP_MS);
      longest = Math.max(longest, s.ms);
    }
  }
  for (const e of events) if (['started', 'finished', 'dropped'].includes(e.type) && Number.isFinite(e.at)) days = bumpDay(days, e.at, e.type);

  const journal: JournalEntry[] = tasks
    .filter((t) => t.status === 'completed' && t.completedAt !== null)
    .sort((a, b) => a.completedAt! - b.completedAt!)
    .map((t) => ({ at: t.completedAt!, taskId: t.id, trackedMs: t.workMs, estimateMs: t.estimateMs, startLatencyMs: t.startLatencyMs ?? 0, grade: null, clean: true }));
  let current = 0;
  let best = 0;
  for (const j of journal) if (j.trackedMs >= CHAIN_MIN_MS) best = Math.max(best, ++current);

  return {
    ...emptyData(),
    tasks,
    settings: mergeSettings(raw.settings),
    windowPos: windowPos(raw.windowPos),
    events,
    days,
    journal,
    bests: { longestStretchMs: longest },
    chain: { current, best },
  };
}

/** Sanitise a v2 file. Returns null if it is unusable. */
export function coerceV2(raw: Raw): AppData | null {
  if (raw.version !== 2 || !Array.isArray(raw.tasks)) return null;
  const base = emptyData();
  const bests = isObj(raw.bests) ? raw.bests : {};
  const chain = isObj(raw.chain) ? raw.chain : {};
  return {
    ...base,
    tasks: raw.tasks.filter(isObj).map(toTask).filter((t): t is Task => t !== null),
    settings: mergeSettings(raw.settings),
    windowPos: windowPos(raw.windowPos),
    events: Array.isArray(raw.events) ? (raw.events as AppEvent[]) : [],
    days: isObj(raw.days) ? (raw.days as AppData['days']) : {},
    journal: Array.isArray(raw.journal) ? (raw.journal as JournalEntry[]) : [],
    bests: { longestStretchMs: num(bests.longestStretchMs, 0) },
    chain: { current: num(chain.current, 0), best: num(chain.best, 0) },
    orphanedDeletedMs: num(raw.orphanedDeletedMs, 0),
  };
}
