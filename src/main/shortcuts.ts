// Global shortcuts. Re-registered from scratch whenever settings change; a
// failed registration (usually: another app owns that combination) is reported
// back to the Settings form instead of failing silently.

import { globalShortcut } from 'electron';
import type { Settings } from '../shared/types';

export interface ShortcutActions {
  togglePanel(): void;
  startPause(): void;
}

/** Returns a human-readable error, or null when everything registered. */
export function registerShortcuts(settings: Settings, actions: ShortcutActions): string | null {
  globalShortcut.unregisterAll();
  if (!settings.shortcutsEnabled) return null;
  const failed: string[] = [];
  const pairs: [string, () => void][] = [
    [settings.shortcuts.togglePanel, actions.togglePanel],
    [settings.shortcuts.startPause, actions.startPause],
  ];
  for (const [accel, fn] of pairs) {
    try {
      if (!globalShortcut.register(accel, fn)) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return failed.length ? `Could not register ${failed.join(' and ')} (in use by another app?)` : null;
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
