import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'unknown';
}

export function hudSnapshotPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.HUD_DIR, `${safeSessionId(sessionId)}.json`);
}

export function hudReceiptPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.HUD_DIR, `${safeSessionId(sessionId)}.receipt.md`);
}

export function hudVerdictPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.HUD_DIR, `${safeSessionId(sessionId)}.verdict.json`);
}

export const HUD_COST_CACHE_SUFFIX = '.cost-cache.json';

export function hudCostCachePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.HUD_DIR, `${safeSessionId(sessionId)}${HUD_COST_CACHE_SUFFIX}`);
}

let tempSeq = 0;

export function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  tempSeq = (tempSeq + 1) % Number.MAX_SAFE_INTEGER;
  const temp = `${target}.tmp-${process.pid}-${tempSeq}`;
  try {
    writeFileSync(temp, content, 'utf8');
    renameWithRetrySync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
