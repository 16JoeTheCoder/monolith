// Data model shared by main, preload and renderer. Pure types only, so every
// layer (and the tests) agree on one shape without importing Electron.

export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TimerMode = 'countdown' | 'pomodoro' | 'stopwatch';
export type Phase = 'work' | 'shortBreak' | 'longBreak';
export type RunStatus = 'idle' | 'running' | 'paused' | 'completed';
export type TaskStatus = 'queued' | 'active' | 'completed';

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
  notes: string;
  finishCondition: string;
  priority: Priority;
  value: number;
  valueIsEarned: boolean;
  deadline: string | null;
  estimateMs: number | null;
  status: TaskStatus;
  timer: TimerConfig;
  runtime: Runtime;
  workMs: number;
  breakMs: number;
  pomodorosCompleted: number;
  sessions: Session[];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  droppedCount: number;
}

export const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'JPY', 'KRW', 'CHF', 'GBP', 'MYR', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Shortcuts {
  togglePanel: string;
  startPause: string;
}

export interface Settings {
  defaultTimer: TimerConfig;
  idleOpacity: number;
  currency: Currency;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  launchAtStartup: boolean;
  shortcutsEnabled: boolean;
  shortcuts: Shortcuts;
  showMoneyInCompact: boolean;
}

export interface AppEvent {
  type: 'started' | 'finished' | 'dropped';
  taskId: string;
  at: number;
  /** Only for 'dropped': the reason typed in the drop modal. */
  reason?: string;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  settings: Settings;
  windowPos: { x: number; y: number } | null;
  events: AppEvent[];
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
  notes: string;
  finishCondition: string;
  priority: Priority;
  value: number;
  valueIsEarned: boolean;
  deadline: string | null;
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
  notes?: string;
  priority?: Priority;
  value?: number;
  valueIsEarned?: boolean;
  deadline?: string | null;
  estimateMs?: number | null;
  timer?: TimerConfig;
}

/** Everything the renderer needs; pushed on change, never per second. */
export interface Snapshot {
  tasks: Task[];
  settings: Settings;
  events: AppEvent[];
  pendingGap: Gap | null;
  expanded: boolean;
  shortcutError: string | null;
  isPackaged: boolean;
}

export type Command =
  | { type: 'addTask'; input: NewTaskInput }
  | { type: 'deleteTask'; taskId: string; confirmed: boolean }
  | { type: 'moveTask'; taskId: string; direction: 'up' | 'down' }
  | { type: 'completeTask'; taskId: string; phrase: string }
  | { type: 'dropTask'; taskId: string; reason: string }
  | { type: 'reopenTask'; taskId: string }
  | { type: 'timer'; action: 'start' | 'pause' | 'reset' | 'skip' }
  | { type: 'answerGap'; count: boolean }
  | { type: 'saveDraft'; draft: Draft }
  | { type: 'setLaunchAtStartup'; enabled: boolean };

export type CommandResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };
