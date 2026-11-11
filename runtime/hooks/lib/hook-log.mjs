import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const HOOK_FAILURE_LOG = 'hook-failures.log';
export const HOOK_DEBUG_LOG = 'hook-debug.log';

export function hookFailureLogPath(projectRoot) {
  return join(projectRoot, '.paqad', 'logs', HOOK_FAILURE_LOG);
}

function describe(error) {
  if (error instanceof Error) {
    return error.code ? `${error.code} ${error.message}` : error.message;
  }
  return String(error);
}

export function logHookFailure(projectRoot, hook, error, note) {
  try {
    const logsDir = join(projectRoot, '.paqad', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const suffix = note ? ` (${note})` : '';
    const line = `[${new Date().toISOString()}] ERROR ${hook}${suffix}: ${describe(error)}\n`;
    appendFileSync(join(logsDir, HOOK_FAILURE_LOG), line);
    return true;
  } catch {
    return false;
  }
}

export function logHookDebug(projectRoot, hook, note) {
  try {
    const logsDir = join(projectRoot, '.paqad', 'logs');
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(
      join(logsDir, HOOK_DEBUG_LOG),
      `[${new Date().toISOString()}] DEBUG ${hook}: ${note}\n`,
    );
    return true;
  } catch {
    return false;
  }
}
