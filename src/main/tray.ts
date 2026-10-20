// System tray icon and menu. The overlay has no taskbar button, so the tray is
// the way back to the panel and the only always-available Quit.

import { Menu, Tray, nativeImage } from 'electron';

// 32 px PNG produced by `node scripts/make-icon.mjs --tray` (same artwork as build/icon.png).
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAj0lEQVR42mNgwALEJGQNxCRkHaiMDRgIAajC+2ISsv9phEFmO+Cy' +
  'PIGGFqPjBGw+/09n7IDsAKKD3c7B7X9jazdWDJIjJTqQExzRGrftPvT/zadfWDFIjsRQMCA5+KnsAIdRB4w6YNQBow4YdcCoA0Yd' +
  'MOqAUQcMCgcMbKN0wJvlg6JjMuBds0HROR2o7jkAe2RUnzSUvZ0AAAAASUVORK5CYII=';

export interface TrayActions {
  open(): void;
  collapse(): void;
  setStartup(enabled: boolean): void;
  quit(): void;
}

export class AppTray {
  private tray: Tray;

  constructor(private actions: TrayActions, private startupAvailable: boolean) {
    this.tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
    this.tray.setToolTip('Monolith');
    this.tray.on('click', () => actions.open());
  }

  update(launchAtStartup: boolean): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open panel', click: () => this.actions.open() },
        { label: 'Collapse', click: () => this.actions.collapse() },
        { type: 'separator' },
        {
          label: this.startupAvailable ? 'Start with Windows' : 'Start with Windows (installed build only)',
          type: 'checkbox',
          checked: launchAtStartup,
          enabled: this.startupAvailable,
          click: (item) => this.actions.setStartup(item.checked),
        },
        { type: 'separator' },
        { label: 'Quit Monolith', click: () => this.actions.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
