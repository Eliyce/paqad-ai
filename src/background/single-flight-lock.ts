import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { LockOutcome } from './types.js';

function noFollow(): number {
  return constants.O_NOFOLLOW ?? 0;
}

export const UNPARSEABLE_LOCK_GRACE_MS = 10_000;

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
  now?: () => number;
}

export function tryAcquireFileLock<T>(
  path: string,
  options: FileLockOptions<T>,
): FileLockOutcome<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (createExclusive(path, options.body)) return { acquired: true, reclaimed: null };
  const judged = readLockText(path);
  if (judged === null) return { acquired: false, holder: null };
  const holder = options.parse(judged.text);
  const now = options.now ?? Date.now;
  const stale =
    holder === null
      ? now() - judged.mtimeMs > UNPARSEABLE_LOCK_GRACE_MS
      : options.holderGone(holder);
  if (!stale) return { acquired: false, holder };
  if (!setAside(path, judged.text)) {
    return { acquired: false, holder: readHolder(path, options.parse) };
  }
  return createExclusive(path, options.body)
    ? { acquired: true, reclaimed: holder }
    : { acquired: false, holder: readHolder(path, options.parse) };
}

function setAside(path: string, judgedText: string): boolean {
  const aside = `${path}.reclaim-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    renameSync(path, aside);
  } catch {
    return false;
  }
  const moved = readLockText(aside);
  if (moved !== null && moved.text === judgedText) {
    unlinkSync(aside);
    return true;
  }
  try {
    if (moved === null) renameSync(aside, path);
    else {
      linkSync(aside, path);
      unlinkSync(aside);
    }
  } catch {}
  return false;
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
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow(),
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

function readLockText(path: string): { text: string; mtimeMs: number } | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow());
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    return { text: readFileSync(fd, 'utf8'), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function readHolder<T>(path: string, parse: (text: string) => T | null): T | null {
  const lock = readLockText(path);
  return lock === null ? null : parse(lock.text);
}
