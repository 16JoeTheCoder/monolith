// Minimal crash log at userData/logs/monolith.log. Rotates at 1 MB, keeping
// one backup (monolith.log.1), so a friend can send it without it ever growing.

import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;
let file: string | null = null;

export function initLog(userData: string): string {
  const dir = path.join(userData, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'monolith.log');
  return file;
}

export function log(message: string): void {
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never take the app down.
  }
}

export function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
}
