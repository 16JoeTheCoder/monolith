// Data model shared by main, preload and renderer. Pure types only, so every
// layer (and the tests) agree on one shape without importing Electron.

export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TimerMode = 'countdown' | 'pomodoro' | 'stopwatch';
export type Phase = 'work' | 'shortBreak' | 'longBreak';
export type RunStatus = 'idle' | 'running' | 'paused' | 'completed';
export type TaskStatus = 'queued' | 'active' | 'completed';
export type Grade = 'fully' | 'mostly' | 'barely';
export type DropKind = 'blocked' | 'lostFocus';

export interface CountdownConfig {
  durationMs: number;
  onExpire: 'stop' | 'continue';
}

export interface PomodoroConfig {
  workMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
}

export interface TimerConfig {
  mode: TimerMode;
  countdown: CountdownConfig;
  pomodoro: PomodoroConfig;
}

export interface Runtime {
  status: RunStatus;
  phase: Phase;
  /** Time accumulated in the current phase by slices that are already closed. */
  phaseElapsedMs: number;
  /** Epoch ms when the currently running slice began, or null when not running. */
  sliceStartedAt: number | null;
  cycleSessions: number;
  expiredNotified: boolean;
}

export interface Session {
  startedAt: number;
  endedAt: number;
  ms: number;
  kind: 'work' | 'break';
}

export interface Task {
  id: string;
  name: string;
  finishCondition: string;
  priority: Priority;
  estimateMs: number | null;
  status: TaskStatus;
  timer: TimerConfig;
  runtime: Runtime;
  workMs: number;
  breakMs: number;
  pomodorosCompleted: number;
  sessions: Session[];
  createdAt: number;
  /** When the task last became the active task. */
  activatedAt: number | null;
  startedAt: number | null;
  /** Time from first becoming active to the first Start press. */
  startLatencyMs: number | null;
  completedAt: number | null;
  droppedCount: number;
  lostFocusDrops: number;
}

export const THEMES = ['graphite', 'midnight', 'ember', 'forest'] as const;
export type Theme = (typeof THEMES)[number];

export interface Shortcuts {
  togglePanel: string;
  startPause: string;
}

/** Compact card typography, in CSS px. Clamped to the ranges in APPEARANCE_LIMITS. */
export interface Appearance {
  statusPx: number;
  titlePx: number;
  digitsPx: number;
  barPx: number;
}

export interface Settings {
  defaultTimer: TimerConfig;
  /** Compact card background alpha, 0-1 (shown as 0-100%). */
  idleOpacity: number;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  launchAtStartup: boolean;
  shortcutsEnabled: boolean;
  shortcuts: Shortcuts;
  appearance: Appearance;
  theme: Theme;
  /** Custom accent colour (#rrggbb) overriding the theme's, or null. */
  accent: string | null;
  onboarded: boolean;
}

export interface AppEvent {
  type: 'started' | 'finished' | 'dropped';
  taskId: string;
  at: number;
  /** Only for 'dropped': the reason typed in the drop modal. */
  reason?: string;
  kind?: DropKind;
}

/** One local calendar day. Survives task deletion. */
export interface DayRecord {
  focusMs: number;
  /** Focus time from slices of at least 15 minutes. */
  deepMs: number;
  pauses: number;
  started: number;
  finished: number;
  dropped: number;
  /** Focus ms per local hour, 24 entries. */
  byHour: number[];
}

export interface JournalEntry {
  at: number;
  taskId: string;
  trackedMs: number;
  estimateMs: number | null;
  startLatencyMs: number;
  grade: Grade | null;
  /** No lost-focus drop on this task. */
  clean: boolean;
}

export interface AppData {
  version: 2;
  tasks: Task[];
  settings: Settings;
  windowPos: { x: number; y: number } | null;
  events: AppEvent[];
  days: Record<string, DayRecord>;
  journal: JournalEntry[];
  bests: { longestStretchMs: number };
  chain: { current: number; best: number };
  orphanedDeletedMs: number;
}

/** Time the app could not observe (PC off, asleep, crashed, clock jump). */
export interface Gap {
  from: number;
  to: number;
  reason: 'off' | 'sleep' | 'clock';
}

/** Emitted by the timer engine when a boundary is crossed. */
export interface TimerEvent {
  kind: 'countdownExpired' | 'phaseEnded';
  taskId: string;
  from: Phase;
  to: Phase;
  autoStarted: boolean;
}

/** The fields of a task that live in the renderer's draft and go through saveDraft. */
export interface TaskEdit {
  id: string;
  name: string;
  finishCondition: string;
  priority: Priority;
  estimateMs: number | null;
  timer: TimerConfig;
}

export interface Draft {
  tasks: TaskEdit[];
  settings: Settings | null;
}

export interface NewTaskInput {
  name: string;
  finishCondition: string;
  priority?: Priority;
  estimateMs?: number | null;
  timer?: TimerConfig;
}

/** Everything the renderer needs; pushed on change, never per second. */
export interface Snapshot {
  data: Omit<AppData, 'windowPos'>;
  pendingGap: Gap | null;
  expanded: boolean;
  shortcutError: string | null;
  isPackaged: boolean;
  version: string;
}

export type Command =
  | { type: 'addTask'; input: NewTaskInput }
  | { type: 'deleteTask'; taskId: string; confirmed: boolean }
  | { type: 'moveTask'; taskId: string; direction: 'up' | 'down' }
  | { type: 'completeTask'; taskId: string; phrase: string; grade: Grade }
  | { type: 'dropTask'; taskId: string; reason: string; kind: DropKind }
  | { type: 'reopenTask'; taskId: string }
  | { type: 'timer'; action: 'start' | 'pause' | 'reset' | 'skip' }
  | { type: 'answerGap'; count: boolean }
  | { type: 'saveDraft'; draft: Draft }
  | { type: 'setLaunchAtStartup'; enabled: boolean }
  | { type: 'dismissWelcome' }
  | { type: 'resetAll' };

export type CommandResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };
