import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export const CHECKS_RUNNING_CEILING_MS = 30 * 60 * 1000;

const CHECKS_RUN_COMMAND = /\bchecks\s+run\b/;

export interface ChecksRunningMarker {
  pid: number;
  session_id: string;
  change: string | null;
  started_at: string;
}

export interface ChecksMarkerProbe {
  now?: () => Date;
  isAlive?: (pid: number) => boolean;
  commandOf?: (pid: number) => string | null;
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'unknown';
}

export function checksRunningMarkerPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.CHECKS_DIR, 'running', `${safeSessionId(sessionId)}.json`);
}

export function writeChecksRunningMarker(projectRoot: string, marker: ChecksRunningMarker): string {
  const path = checksRunningMarkerPath(projectRoot, marker.session_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return path;
}

export function readChecksRunningMarker(
  projectRoot: string,
  sessionId: string,
): ChecksRunningMarker | null {
  try {
    const parsed = JSON.parse(
      readFileSync(checksRunningMarkerPath(projectRoot, sessionId), 'utf8'),
    ) as unknown;
    return isMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearChecksRunningMarker(
  projectRoot: string,
  sessionId: string,
  pid: number,
): void {
  if (readChecksRunningMarker(projectRoot, sessionId)?.pid !== pid) {
    return;
  }
  rmSync(checksRunningMarkerPath(projectRoot, sessionId), { force: true });
}

export function liveChecksRunningMarker(
  projectRoot: string,
  sessionId: string,
  probe: ChecksMarkerProbe = {},
): ChecksRunningMarker | null {
  const marker = readChecksRunningMarker(projectRoot, sessionId);
  if (!marker || marker.session_id !== sessionId) {
    return null;
  }
  const age = (probe.now ?? (() => new Date()))().getTime() - Date.parse(marker.started_at);
  if (Number.isNaN(age) || age < 0 || age >= CHECKS_RUNNING_CEILING_MS) {
    return null;
  }
  if (!(probe.isAlive ?? processIsAlive)(marker.pid)) {
    return null;
  }
  const command = (probe.commandOf ?? processCommand)(marker.pid);
  return command !== null && CHECKS_RUN_COMMAND.test(command) ? marker : null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function processCommand(pid: number): string | null {
  if (process.platform === 'win32') {
    return null;
  }
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isMarker(value: unknown): value is ChecksRunningMarker {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const m = value as Record<string, unknown>;
  return (
    Number.isInteger(m.pid) &&
    (m.pid as number) > 0 &&
    typeof m.session_id === 'string' &&
    (m.change === null || typeof m.change === 'string') &&
    typeof m.started_at === 'string'
  );
}
