// Preload (sandboxed): exposes window.monolith and nothing else. The renderer
// never sees ipcRenderer itself, only these typed wrappers.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, type MonolithApi } from '../shared/api';
import type { Snapshot } from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: MonolithApi = {
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot),
  onSnapshot: (cb) => subscribe<Snapshot>(CHANNELS.snapshot, cb),
  onBeep: (cb) => subscribe<void>(CHANNELS.beep, () => cb()),
  command: (cmd) => ipcRenderer.invoke(CHANNELS.command, cmd),
  expand: () => ipcRenderer.invoke(CHANNELS.expand),
  collapse: () => ipcRenderer.invoke(CHANNELS.collapse),
  reportSize: (w, h) => ipcRenderer.send(CHANNELS.reportSize, w, h),
  dragStart: () => ipcRenderer.send(CHANNELS.dragStart),
  dragEnd: () => ipcRenderer.invoke(CHANNELS.dragEnd),
  quit: () => ipcRenderer.send(CHANNELS.quit),
  restart: (reason) => ipcRenderer.send(CHANNELS.restart, reason),
};

contextBridge.exposeInMainWorld('monolith', api);
