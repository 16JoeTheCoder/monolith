// Electron entry point: wires the controller (state + persistence) to the
// overlay window, tray, global shortcuts, power events and notifications.
// One instance only; a second launch just opens the panel of the first.

import path from 'node:path';
import { Notification, app, powerMonitor } from 'electron';
import { CHANNELS } from '../shared/api';
import { phaseLabel } from '../shared/format';
import type { Settings, Snapshot, TimerEvent } from '../shared/types';
import { Controller } from './controller';
import { registerIpc } from './ipc';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { Store } from './store';
import { AppTray } from './tray';
import { OverlayWindow } from './window';

const TICK_MS = 250;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.monolith.app');
  app.whenReady().then(boot);
}

function boot(): void {
  let shortcutError: string | null = null;
  let quitting = false;

  const controller = new Controller(new Store(app.getPath('userData')), {
    onChange: () => broadcast(),
    onTimerEvents: (events) => notify(events),
    onSettingsChanged: (prev, next) => applySettings(next, prev),
    // Auto-expand for the gap prompt, without stealing focus from what the user is doing.
    onGap: () => {
      overlay.expand(false);
      broadcast();
    },
  });
  controller.init(Date.now());

  const overlay = new OverlayWindow(path.join(__dirname, 'preload.js'), controller.data.windowPos, (pos) => controller.setWindowPos(pos));
  const devUrl = process.env.MONOLITH_DEV_URL;
  if (devUrl) void overlay.win.loadURL(devUrl);
  else void overlay.win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Block navigation and new windows: the renderer only ever shows our page.
  overlay.win.webContents.on('will-navigate', (e) => e.preventDefault());
  overlay.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.win.on('close', (e) => {
    if (!quitting) e.preventDefault();
  });

  const expand = (focus: boolean) => {
    overlay.expand(focus);
    broadcast();
  };
  const collapse = () => {
    overlay.collapse();
    broadcast();
  };
  const quit = () => {
    quitting = true;
    app.quit();
  };

  const tray = new AppTray(
    {
      open: () => expand(true),
      collapse: () => broadcast(true),
      setStartup: (enabled) => controller.command({ type: 'setLaunchAtStartup', enabled }, Date.now()),
      quit,
    },
    app.isPackaged,
  );

  function snapshot(): Snapshot {
    const d = controller.data;
    return {
      tasks: d.tasks,
      settings: d.settings,
      events: d.events,
      pendingGap: controller.pendingGap,
      expanded: overlay.expanded,
      shortcutError,
      isPackaged: app.isPackaged,
    };
  }

  /**
   * Push state to the renderer. `requestCollapse` asks the renderer to run its
   * own collapse flow (swap view first, then call collapse) so a dirty draft
   * still gets the Save/Discard prompt.
   */
  function broadcast(requestCollapse = false): void {
    if (overlay.win.isDestroyed()) return;
    const snap = snapshot();
    overlay.win.webContents.send(CHANNELS.snapshot, requestCollapse ? { ...snap, expanded: false } : snap);
  }

  function applySettings(next: Settings, prev?: Settings): void {
    if (!prev || prev.shortcutsEnabled !== next.shortcutsEnabled || JSON.stringify(prev.shortcuts) !== JSON.stringify(next.shortcuts)) {
      shortcutError = registerShortcuts(next, {
        togglePanel: () => (overlay.expanded ? broadcast(true) : expand(true)),
        startPause: () => controller.toggleStartPause(Date.now()),
      });
    }
    // Login items only make sense for the installed exe, not for electron.exe in dev.
    if (app.isPackaged && (!prev || prev.launchAtStartup !== next.launchAtStartup)) {
      app.setLoginItemSettings({ openAtLogin: next.launchAtStartup });
    }
    tray.update(next.launchAtStartup);
  }

  function notify(events: TimerEvent[]): void {
    const s = controller.data.settings;
    const last = events.at(-1);
    if (!last) return;
    const task = controller.data.tasks.find((t) => t.id === last.taskId);
    const name = task?.name ?? 'Your task';
    let title: string;
    let body: string;
    if (last.kind === 'countdownExpired') {
      title = "Time's up";
      body = last.autoStarted ? `${name}: countdown reached zero, now in overtime.` : `${name}: countdown finished.`;
    } else {
      title = last.to === 'work' ? 'Break over' : `${phaseLabel(last.to)} time`;
      body = `${name}: ${last.autoStarted ? `${phaseLabel(last.to)} started.` : `press Start when you are ready for ${phaseLabel(last.to).toLowerCase()}.`}`;
    }
    if (s.notificationsEnabled && Notification.isSupported()) new Notification({ title, body, silent: true }).show();
    if (s.soundEnabled) overlay.win.webContents.send(CHANNELS.beep);
  }

  registerIpc({
    isOurSender: (e) => e.sender === overlay.win.webContents,
    snapshot,
    command: (cmd) => controller.command(cmd, Date.now()),
    expand: () => expand(true),
    collapse,
    reportHeight: (h) => overlay.setCompactHeight(h),
    dragStart: () => overlay.dragStart(),
    dragEnd: () => overlay.dragEnd(),
    quit,
  });

  applySettings(controller.data.settings);
  if (controller.pendingGap) overlay.win.webContents.once('did-finish-load', () => expand(false));

  const tick = setInterval(() => controller.tick(Date.now()), TICK_MS);
  powerMonitor.on('suspend', () => controller.suspend(Date.now()));
  powerMonitor.on('resume', () => controller.resume(Date.now()));
  powerMonitor.on('shutdown', () => controller.shutdown(Date.now()));

  app.on('second-instance', () => expand(true));
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(tick);
    controller.shutdown(Date.now());
    unregisterShortcuts();
    tray.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
