// JSON persistence for AppData plus a heartbeat file. Takes a directory instead
// of calling app.getPath so it can be tested without Electron.
// Writes are crash-safe: write .tmp, fsync, keep the previous file as .bak,
// then rename .tmp over the real file (rename is atomic on NTFS and ext4).
// A corrupt main file falls back to .bak, then to empty data.

import fs from 'node:fs';
import path from 'node:path';
import { defaultSettings, emptyData, normalize } from '../shared/tasks';
import { CURRENCIES } from '../shared/types';
import type { AppData, Settings } from '../shared/types';
import { validateSettings } from '../shared/validation';

export class Store {
  readonly file: string;
  readonly bak: string;
  readonly tmp: string;
  readonly heartbeatFile: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'monolith-data.json');
    this.bak = `${this.file}.bak`;
    this.tmp = `${this.file}.tmp`;
    this.heartbeatFile = path.join(dir, 'heartbeat');
  }

  load(now: number): AppData {
    for (const f of [this.file, this.bak]) {
      const data = readData(f);
      if (data) return normalize(data, now);
    }
    return emptyData();
  }

  save(data: AppData): void {
    writeDurable(this.tmp, JSON.stringify(data));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.bak);
    fs.renameSync(this.tmp, this.file);
  }

  writeHeartbeat(now: number): void {
    try {
      writeDurable(this.heartbeatFile, String(now));
    } catch {
      // A missed heartbeat only makes recovery slightly more conservative.
    }
  }

  readHeartbeat(): number | null {
    try {
      const n = Number(fs.readFileSync(this.heartbeatFile, 'utf8'));
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }
}

function writeDurable(file: string, text: string): void {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Parse and lightly sanitise a data file. Returns null if it is unusable. */
function readData(file: string): AppData | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.version !== 1 || !Array.isArray(raw.tasks)) return null;
    const settings = mergeSettings(raw.settings);
    const pos = raw.windowPos;
    return {
      version: 1,
      tasks: raw.tasks.filter((t: unknown) => t && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string'),
      settings,
      windowPos: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: pos.x, y: pos.y } : null,
      events: Array.isArray(raw.events) ? raw.events : [],
    };
  } catch {
    return null;
  }
}

/** Fill missing settings from defaults; an invalid stored set falls back to defaults. */
function mergeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Settings>;
  const merged: Settings = { ...d, ...r, shortcuts: { ...d.shortcuts, ...r.shortcuts }, defaultTimer: r.defaultTimer ?? d.defaultTimer };
  if (!CURRENCIES.includes(merged.currency)) merged.currency = d.currency;
  return Object.keys(validateSettings(merged)).length ? d : merged;
}
