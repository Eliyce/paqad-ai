import { renameSync, rmSync } from 'node:fs';
import { rename as renameAsync, rm as rmAsync } from 'node:fs/promises';

const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export const RENAME_MAX_ATTEMPTS = 5;

function waitBeforeRetry(attempt: number): number {
  return 10 * 2 ** (attempt - 1);
}

function isRetryable(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

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

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
        await remove(from).catch(() => undefined);
        throw error;
      }
      await sleep(waitBeforeRetry(attempt));
    }
  }
}

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
        } catch {}
        throw error;
      }
      sleep(waitBeforeRetry(attempt));
      attemptRename(attempt + 1);
    }
  };
  attemptRename(1);
}
