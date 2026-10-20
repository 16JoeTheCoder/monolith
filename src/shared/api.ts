// The one API the preload exposes to the renderer as window.monolith.
// Kept small on purpose: a snapshot stream, one command channel, and the
// handful of window operations that must run in main.

import type { Command, CommandResult, Snapshot } from './types';

export interface MonolithApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  /** Fired by main when a sound should play (sound is synthesised in the renderer). */
  onBeep(cb: () => void): () => void;
  command(cmd: Command): Promise<CommandResult>;
  expand(): Promise<void>;
  collapse(): Promise<void>;
  /** The compact card's measured size; main fits the window to it (top-left anchored). */
  reportSize(width: number, height: number): void;
  dragStart(): void;
  /** Resolves true if the pointer moved more than 4 px (a drag), false for a click. */
  dragEnd(): Promise<boolean>;
  quit(): void;
  /** Log the reason and relaunch the app (used by the renderer's error boundary). */
  restart(reason: string): void;
}

export const CHANNELS = {
  getSnapshot: 'monolith:getSnapshot',
  snapshot: 'monolith:snapshot',
  beep: 'monolith:beep',
  command: 'monolith:command',
  expand: 'monolith:expand',
  collapse: 'monolith:collapse',
  reportSize: 'monolith:reportSize',
  dragStart: 'monolith:dragStart',
  dragEnd: 'monolith:dragEnd',
  quit: 'monolith:quit',
  restart: 'monolith:restart',
} as const;
