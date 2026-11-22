import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { LockOutcome } from './types.js';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export function tryAcquireLock(
  lockDir: string,
  options: { staleLockMs: number; now?: () => number },
): LockOutcome {
  const now = options.now ?? Date.now;
  try {
    mkdirSync(dirname(lockDir), { recursive: true });
  } catch {}

  try {
    mkdirSync(lockDir);
    return { acquired: true, reclaimedStale: false };
  } catch {}

  let ageMs: number;
  try {
    ageMs = now() - statSync(lockDir).mtimeMs;
  } catch {
    return retryAcquire(lockDir, true);
  }

  if (ageMs <= options.staleLockMs) {
    return { acquired: false };
  }

  try {
    rmdirSync(lockDir);
  } catch {
    return { acquired: false };
  }
  return retryAcquire(lockDir, true);
}

export function releaseLock(lockDir: string): void {
  try {
    rmdirSync(lockDir);
  } catch {}
}

function retryAcquire(lockDir: string, reclaimedStale: boolean): LockOutcome {
  try {
    mkdirSync(lockDir);
    return { acquired: true, reclaimedStale };
  } catch {
    return { acquired: false };
  }
}

export type FileLockOutcome<T> =
  { acquired: true; reclaimed: T | null } | { acquired: false; holder: T | null };

export interface FileLockOptions<T> {
  body: T;
  holderGone: (holder: T) => boolean;
  parse: (text: string) => T | null;
}

export function tryAcquireFileLock<T>(
  path: string,
  options: FileLockOptions<T>,
): FileLockOutcome<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (createExclusive(path, options.body)) return { acquired: true, reclaimed: null };
  const holder = readHolder(path, options.parse);
  if (holder === null || !options.holderGone(holder)) {
    return { acquired: false, holder };
  }
  try {
    if (lstatSync(path).isSymbolicLink()) return { acquired: false, holder };
    unlinkSync(path);
  } catch {
    return { acquired: false, holder };
  }
  return createExclusive(path, options.body)
    ? { acquired: true, reclaimed: holder }
    : { acquired: false, holder: readHolder(path, options.parse) };
}

export function releaseFileLock<T>(
  path: string,
  owner: T,
  parse: (text: string) => T | null,
  same: (a: T, b: T) => boolean,
): void {
  const holder = readHolder(path, parse);
  if (holder === null || !same(holder, owner)) return;
  try {
    unlinkSync(path);
  } catch {}
}

function createExclusive(path: string, body: unknown): boolean {
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW,
      0o600,
    );
  } catch {
    return false;
  }
  try {
    writeSync(fd, `${JSON.stringify(body)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

function readHolder<T>(path: string, parse: (text: string) => T | null): T | null {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    return parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
