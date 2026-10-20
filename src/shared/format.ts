// Formatting and calendar helpers shared by the renderer and main
// (notifications, gap prompt). Pure; local time zone via Date.

/** 1:05:09 or 25:00. Used for the large timer digits. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 2h 05m, 14m, 40s. Used for totals. */
export function formatHuman(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${total % 60}s`;
}

/** HH:MM in local time. */
export function formatTimeOfDay(epoch: number): string {
  const d = new Date(epoch);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Local calendar day key, 'YYYY-MM-DD'. */
export function dayKey(epoch: number): string {
  const d = new Date(epoch);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight `n` days after the day containing `epoch` (DST-safe). */
export function addDays(epoch: number, n: number): number {
  const d = new Date(startOfDay(epoch));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 local time of the week containing `now`. */
export function startOfWeek(now: number): number {
  const d = new Date(startOfDay(now));
  const back = (d.getDay() + 6) % 7; // Sunday=0 -> 6 days back
  d.setDate(d.getDate() - back);
  return d.getTime();
}

export function phaseLabel(phase: string): string {
  return phase === 'work' ? 'Work' : phase === 'shortBreak' ? 'Short break' : 'Long break';
}

export function modeLabel(mode: string): string {
  return mode === 'countdown' ? 'Countdown' : mode === 'pomodoro' ? 'Pomodoro' : 'Stopwatch';
}
