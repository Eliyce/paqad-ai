// The TypeScript side of `.paqad/logs/hooks.log` (issue #639, AC-69).
//
// A record-only write that runs inside a hook (the change cost, the acceptance-criteria map)
// must never change what the hook decided or printed. When such a write fails, the failure is
// appended here, in the same one-line format `runtime/hooks/lib/paqad-disabled.mjs`
// (`appendHooksLog`) writes, so a hook's own lines and the dist code it calls share one log.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

/** The project-relative path of the hooks log. */
export function hooksLogPath(projectRoot: string): string {
  return join(projectRoot, PATHS.LOGS_DIR, 'hooks.log');
}

/** Append one line to `.paqad/logs/hooks.log`, best-effort: it never throws. */
export function appendHooksLog(projectRoot: string, line: string): void {
  try {
    mkdirSync(join(projectRoot, PATHS.LOGS_DIR), { recursive: true });
    appendFileSync(hooksLogPath(projectRoot), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // The caller's path outranks the log line: a read-only tree must not turn into a throw.
  }
}
