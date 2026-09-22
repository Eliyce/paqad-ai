// hook-log.mjs — the one place a runtime hook records a failure it cannot surface.
//
// Why this exists: a hook must never wedge the host, so every hook soft-fails. Until
// issue #573 that meant a bare `catch {}` with no trace anywhere, and the cost was
// concrete: `agent-entry-prompt-gate.mjs` imported a compiled half that tsup never
// emitted, threw ERR_MODULE_NOT_FOUND on every single prompt, exited 0, and nobody
// noticed for about ten weeks. The prompt router simply never ran, so the recorded lane
// was always null and stage isolation could never trigger.
//
// Soft-failing is still right. Soft-failing SILENTLY is not (RULE-5 RL-10b3, RULE-13
// RL-de1b: never swallow an exception into an empty catch). This helper is the middle
// ground: one append-only line per failure, naming the hook and the underlying error, so
// the next outage is one `cat` away instead of an RCA.
//
// Contract: never throws, never blocks, never returns a rejected promise. A failure to
// log is itself swallowed — the host path is more important than the log line.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Basename of the shared hook-failure log inside `.paqad/logs`. */
export const HOOK_FAILURE_LOG = 'hook-failures.log';

/** Project-relative path of the log, so callers and tests never hand-build it. */
export function hookFailureLogPath(projectRoot) {
  return join(projectRoot, '.paqad', 'logs', HOOK_FAILURE_LOG);
}

/** The message text for an unknown throwable, without leaking a whole stack. */
function describe(error) {
  if (error instanceof Error) {
    return error.code ? `${error.code} ${error.message}` : error.message;
  }
  return String(error);
}

/**
 * Append one line recording that `hook` failed with `error`.
 *
 * @param {string} projectRoot Resolved project root (from `resolveProjectRoot`).
 * @param {string} hook        The hook's name, e.g. `agent-entry-prompt-gate`.
 * @param {unknown} error      Whatever was caught.
 * @param {string} [note]      Optional one-clause hint about what was being attempted.
 * @returns {boolean} true when the line was written; false when logging itself failed.
 */
export function logHookFailure(projectRoot, hook, error, note) {
  try {
    const logsDir = join(projectRoot, '.paqad', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const suffix = note ? ` (${note})` : '';
    const line = `[${new Date().toISOString()}] ERROR ${hook}${suffix}: ${describe(error)}\n`;
    appendFileSync(join(logsDir, HOOK_FAILURE_LOG), line);
    return true;
  } catch {
    // The host path outranks the log line. A read-only or missing project root, a full
    // disk, or a permission fault must not turn a soft-failed hook into a hard one.
    return false;
  }
}
