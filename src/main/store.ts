// JSON persistence for AppData plus a heartbeat file. Takes a directory instead
// of calling app.getPath so it can be tested without Electron.
// Writes are crash-safe: write .tmp, fsync, keep the previous file as .bak,
// then rename .tmp over the real file (rename is atomic on NTFS and ext4).
// A corrupt main file falls back to .bak, then to empty data.
// A v1 file (Monolith 0.1) is copied once to state.v1.bak.json, then migrated.

import fs from 'node:fs';
import path from 'node:path';
import { coerceV2, migrateV1 } from '../shared/migrate';
import { emptyData, normalize } from '../shared/tasks';
import type { AppData } from '../shared/types';

export class Store {
  readonly file: string;
  readonly bak: string;
  readonly tmp: string;
  readonly heartbeatFile: string;
  readonly v1Backup: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'monolith-data.json');
    this.bak = `${this.file}.bak`;
    this.tmp = `${this.file}.tmp`;
    this.heartbeatFile = path.join(dir, 'heartbeat');
    this.v1Backup = path.join(dir, 'state.v1.bak.json');
  }

  load(now: number): AppData {
    for (const f of [this.file, this.bak]) {
      const raw = readJson(f);
      if (!raw) continue;
      if (raw.version === 1 && Array.isArray(raw.tasks)) {
        if (!fs.existsSync(this.v1Backup)) fs.copyFileSync(f, this.v1Backup);
        const data = normalize(migrateV1(raw), now);
        this.save(data);
        return data;
      }
      const data = coerceV2(raw);
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

function readJson(file: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
