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
  reportHeight(height: number): void;
  dragStart(): void;
  /** Resolves true if the pointer moved more than 4 px (a drag), false for a click. */
  dragEnd(): Promise<boolean>;
  quit(): void;
}

export const CHANNELS = {
  getSnapshot: 'monolith:getSnapshot',
  snapshot: 'monolith:snapshot',
  beep: 'monolith:beep',
  command: 'monolith:command',
  expand: 'monolith:expand',
  collapse: 'monolith:collapse',
  reportHeight: 'monolith:reportHeight',
  dragStart: 'monolith:dragStart',
  dragEnd: 'monolith:dragEnd',
  quit: 'monolith:quit',
} as const;
