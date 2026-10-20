// Validation rules used by both the renderer (inline errors) and main (the
// authority; every IPC input is re-checked there). Pure, no Electron imports.

import { CURRENCIES } from './types';
import type { Draft, NewTaskInput, Priority, TaskEdit } from './types';

export const FINISH_PHRASE = 'I have finished this task';
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

export type Errors = Record<string, string>;

/** Case-insensitive, trimmed, whitespace collapsed, one trailing period ignored. */
export function normalizePhrase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/\.$/, '').trim().toLowerCase();
}

export function isFinishPhrase(s: unknown): boolean {
  return typeof s === 'string' && normalizePhrase(s) === normalizePhrase(FINISH_PHRASE);
}

export function isDropReason(s: unknown): boolean {
  return typeof s === 'string' && s.trim().length >= 3;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown): v is string => typeof v === 'string';
const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high'];

function inRange(v: unknown, min: number, max: number): boolean {
  return isNum(v) && v >= min && v <= max;
}

export function validateTimer(cfg: unknown, prefix = 'timer'): Errors {
  const e: Errors = {};
  if (!isObj(cfg) || !['countdown', 'pomodoro', 'stopwatch'].includes(cfg.mode as string)) {
    e[`${prefix}.mode`] = 'Choose a timer mode.';
    return e;
  }
  const c = cfg.countdown;
  if (!isObj(c) || !inRange(c.durationMs, SEC, 24 * HOUR)) e[`${prefix}.countdown`] = 'Countdown must be between 1 second and 24 hours.';
  else if (c.onExpire !== 'stop' && c.onExpire !== 'continue') e[`${prefix}.countdown`] = 'Choose what happens at zero.';
  const p = cfg.pomodoro;
  if (!isObj(p)) {
    e[`${prefix}.pomodoro`] = 'Pomodoro settings are missing.';
    return e;
  }
  if (!inRange(p.workMs, MIN, 180 * MIN)) e[`${prefix}.workMs`] = 'Work must be 1-180 minutes.';
  if (!inRange(p.shortBreakMs, MIN, 60 * MIN)) e[`${prefix}.shortBreakMs`] = 'Short break must be 1-60 minutes.';
  if (!inRange(p.longBreakMs, MIN, 60 * MIN)) e[`${prefix}.longBreakMs`] = 'Long break must be 1-60 minutes.';
  if (!Number.isInteger(p.sessionsBeforeLongBreak) || !inRange(p.sessionsBeforeLongBreak, 1, 12)) e[`${prefix}.sessions`] = 'Sessions must be a whole number 1-12.';
  if (!isBool(p.autoStartBreaks) || !isBool(p.autoStartWork)) e[`${prefix}.auto`] = 'Invalid auto-start flags.';
  return e;
}

/** Validates the user-editable fields of a task (new or edited). */
export function validateTaskFields(t: Partial<TaskEdit> | NewTaskInput): Errors {
  const e: Errors = {};
  const name = isStr(t.name) ? t.name.trim() : '';
  if (name.length < 1 || name.length > 120) e.name = 'Name must be 1-120 characters.';
  if (!isStr(t.finishCondition) || t.finishCondition.trim().length < 8) e.finishCondition = 'Describe what finished looks like (at least 8 characters).';
  if (t.notes !== undefined && (!isStr(t.notes) || t.notes.length > 2000)) e.notes = 'Notes can be at most 2000 characters.';
  if (t.priority !== undefined && !PRIORITIES.includes(t.priority)) e.priority = 'Invalid priority.';
  if (t.value !== undefined && (!isNum(t.value) || t.value < 0)) e.value = 'Value must be a number of 0 or more.';
  if (t.valueIsEarned !== undefined && !isBool(t.valueIsEarned)) e.valueIsEarned = 'Invalid flag.';
  if (t.deadline !== undefined && t.deadline !== null && (!isStr(t.deadline) || Number.isNaN(Date.parse(t.deadline)))) e.deadline = 'Invalid deadline.';
  if (t.estimateMs !== undefined && t.estimateMs !== null && (!isNum(t.estimateMs) || t.estimateMs <= 0 || t.estimateMs > 1000 * HOUR)) e.estimateMs = 'Estimate must be positive.';
  if (t.timer !== undefined) Object.assign(e, validateTimer(t.timer));
  return e;
}

/** Electron accelerator check: modifiers joined by "+" ending in exactly one key. */
export function isValidAccelerator(acc: unknown): boolean {
  if (!isStr(acc) || acc.length > 60) return false;
  const parts = acc.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => !p)) return false;
  const mods = new Set(['ctrl', 'control', 'alt', 'shift', 'super', 'meta', 'cmdorctrl', 'commandorcontrol', 'altgr', 'option']);
  const key = parts[parts.length - 1].toLowerCase();
  const keyOk = /^([a-z0-9]|f([1-9]|1[0-9]|2[0-4])|space|tab|enter|return|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right|escape|esc|plus|[`\-=[\];',./\\])$/.test(key);
  return keyOk && !mods.has(key) && parts.slice(0, -1).every((m) => mods.has(m.toLowerCase()));
}

export function validateSettings(s: unknown): Errors {
  const e: Errors = {};
  if (!isObj(s)) return { settings: 'Invalid settings.' };
  Object.assign(e, validateTimer(s.defaultTimer, 'defaultTimer'));
  if (!inRange(s.idleOpacity, 0.5, 0.8)) e.idleOpacity = 'Opacity must be 50-80%.';
  if (!CURRENCIES.includes(s.currency as never)) e.currency = 'Unknown currency.';
  for (const k of ['soundEnabled', 'notificationsEnabled', 'launchAtStartup', 'shortcutsEnabled', 'showMoneyInCompact']) {
    if (!isBool(s[k])) e[k] = 'Invalid flag.';
  }
  const sc = s.shortcuts;
  if (!isObj(sc)) e.shortcuts = 'Invalid shortcuts.';
  else {
    if (!isValidAccelerator(sc.togglePanel)) e['shortcuts.togglePanel'] = 'Use a format like Ctrl+Alt+Space.';
    if (!isValidAccelerator(sc.startPause)) e['shortcuts.startPause'] = 'Use a format like Ctrl+Alt+P.';
    if (!e['shortcuts.togglePanel'] && sc.togglePanel === sc.startPause) e['shortcuts.startPause'] = 'Shortcuts must differ.';
  }
  return e;
}

/** Structural check for a saveDraft payload coming over IPC. */
export function validateDraft(d: unknown): Errors {
  if (!isObj(d) || !Array.isArray(d.tasks)) return { draft: 'Invalid draft.' };
  const e: Errors = {};
  for (const t of d.tasks) {
    if (!isObj(t) || !isStr(t.id) || t.timer === undefined) return { draft: 'Invalid task in draft.' };
    for (const [k, v] of Object.entries(validateTaskFields(t as Partial<TaskEdit>))) e[`${t.id}.${k}`] = v;
  }
  if (d.settings !== null) for (const [k, v] of Object.entries(validateSettings(d.settings))) e[`settings.${k}`] = v;
  return e;
}

export function isDraft(d: unknown): d is Draft {
  return Object.keys(validateDraft(d)).length === 0;
}

export function splitHms(ms: number): { h: number; m: number; s: number } {
  const total = Math.round(ms / 1000);
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function hmsToMs(h: number, m: number, s: number): number {
  return ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000;
}
