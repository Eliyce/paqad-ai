import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export function hooksLogPath(projectRoot: string): string {
  return join(projectRoot, PATHS.LOGS_DIR, 'hooks.log');
}

export function appendHooksLog(projectRoot: string, line: string): void {
  try {
    mkdirSync(join(projectRoot, PATHS.LOGS_DIR), { recursive: true });
    appendFileSync(hooksLogPath(projectRoot), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}
