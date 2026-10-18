// The last step of every "write a temp file, then rename it onto the target" write (issue #647).
//
// On Windows a rename onto a target that another rename or reader is touching at that moment
// fails with EPERM (sometimes EACCES or EBUSY) instead of replacing it. macOS and Linux never
// fail that way, so the retry only runs on win32: elsewhere the first error is rethrown at once.
// When the helper gives up it removes the temp file, so a failed write never leaves a stray
// temp file next to the target.

import { renameSync, rmSync } from 'node:fs';
import { rename as renameAsync, rm as rmAsync } from 'node:fs/promises';

/** Error codes Windows raises for a rename that is only blocked for a moment. */
const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** At most 5 attempts in total. */
export const RENAME_MAX_ATTEMPTS = 5;

/** The wait before retry number `attempt` (1-based): 10, 20, 40, then 80 ms. */
function waitBeforeRetry(attempt: number): number {
  return 10 * 2 ** (attempt - 1);
}

function isRetryable(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

/** Injectable seams for tests. Every field defaults to the real thing. */
export interface RenameWithRetryDeps {
  rename?: (from: string, to: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  platform?: NodeJS.Platform;
}

export interface RenameWithRetrySyncDeps {
  rename?: (from: string, to: string) => void;
  remove?: (path: string) => void;
  sleep?: (ms: number) => void;
  platform?: NodeJS.Platform;
}

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Block the thread for `ms` without a busy loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Rename `from` onto `to`, retrying a short-lived Windows lock. Removes `from` when it gives up. */
export async function renameWithRetry(
  from: string,
  to: string,
  deps: RenameWithRetryDeps = {},
): Promise<void> {
  const rename = deps.rename ?? renameAsync;
  const remove = deps.remove ?? ((path: string) => rmAsync(path, { force: true }));
  const sleep = deps.sleep ?? sleepAsync;
  const platform = deps.platform ?? process.platform;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_MAX_ATTEMPTS || !isRetryable(error, platform)) {
        // Keep the rename error as the one the caller sees, even if the cleanup fails too.
        await remove(from).catch(() => undefined);
        throw error;
      }
      await sleep(waitBeforeRetry(attempt));
    }
  }
}

/** The sync form of {@link renameWithRetry}, for writers that cannot await. */
export function renameWithRetrySync(
  from: string,
  to: string,
  deps: RenameWithRetrySyncDeps = {},
): void {
  const rename = deps.rename ?? renameSync;
  const remove = deps.remove ?? ((path: string) => rmSync(path, { force: true }));
  const sleep = deps.sleep ?? sleepSync;
  const platform = deps.platform ?? process.platform;
  const attemptRename = (attempt: number): void => {
    try {
      rename(from, to);
    } catch (error) {
      if (attempt >= RENAME_MAX_ATTEMPTS || !isRetryable(error, platform)) {
        try {
          remove(from);
        } catch {
          // Keep the rename error as the one the caller sees.
        }
        throw error;
      }
      sleep(waitBeforeRetry(attempt));
      attemptRename(attempt + 1);
    }
  };
  attemptRename(1);
}
