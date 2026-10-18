// The paqad HUD's per-session files (issue #639): where they live and how they are written.
//
// Every write is atomic (a temp file in the same directory, then a rename), so a reader never
// sees half a file and two writers racing leave one whole file, never a mix. Nothing here
// throws to a caller that did not ask for it: the HUD is a view, and a failed view write must
// never change a hook's decision (issue #639, guardrail rule 3).

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

/** A session id made safe for a filename (no separators, no traversal). */
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

let tempSeq = 0;

/** Write `content` to `target` atomically. Throws on failure; callers decide how to degrade. */
export function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  tempSeq = (tempSeq + 1) % Number.MAX_SAFE_INTEGER;
  const temp = `${target}.tmp-${process.pid}-${tempSeq}`;
  try {
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
