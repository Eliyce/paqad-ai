import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';

import { sleepSync } from './atomic-rename.js';

export interface FileLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => void;
}

export class FileLockTimeoutError extends Error {
  constructor(lockDir: string, timeoutMs: number) {
    super(
      `could not take the lock ${lockDir} within ${timeoutMs} ms; another paqad process holds it. ` +
        'Retry the command; if no other paqad command is running, remove that directory.',
    );
    this.name = 'FileLockTimeoutError';
  }
}

export function withFileLockSync<T>(
  lockDir: string,
  fn: () => T,
  options: FileLockOptions = {},
): T {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 10_000;
  const retryMs = options.retryMs ?? 20;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const deadline = now() + timeoutMs;
  for (;;) {
    const outcome = tryAcquireLock(lockDir, { staleLockMs: staleMs, now });
    if (outcome.acquired) break;
    if (now() >= deadline) throw new FileLockTimeoutError(lockDir, timeoutMs);
    sleep(retryMs);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
}

const OWNER_PREFIX = 'owner-';
const CLAIM_PREFIX = 'claim-';

export class FileLockLostError extends Error {
  constructor(lockDir: string) {
    super(`the lock ${lockDir} was taken over while this process was paused`);
    this.name = 'FileLockLostError';
  }
}

export interface OwnedFileLock {
  assertHeld(): void;
  release(): void;
  movedTo(lockDir: string): OwnedFileLock;
}

function uniqueName(prefix: string): string {
  return `${prefix}${process.pid}-${randomBytes(6).toString('hex')}`;
}

function holderIsDead(name: string): boolean {
  const pid = Number(name.slice(OWNER_PREFIX.length).split('-')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function tryTakeOwned(lockDir: string): OwnedFileLock | null {
  try {
    mkdirSync(lockDir);
  } catch {
    return null;
  }
  const owner = uniqueName(OWNER_PREFIX);
  try {
    writeFileSync(join(lockDir, owner), '');
    if (readdirSync(lockDir).length === 1) return ownedLock(lockDir, owner);
    unlinkSync(join(lockDir, owner));
    rmdirSync(lockDir);
  } catch {}
  return null;
}

function ownedLock(lockDir: string, owner: string): OwnedFileLock {
  const token = join(lockDir, owner);
  return {
    assertHeld() {
      try {
        const at = new Date();
        utimesSync(lockDir, at, at);
      } catch {}
      if (!existsSync(token)) throw new FileLockLostError(lockDir);
    },
    release() {
      try {
        unlinkSync(token);
        rmdirSync(lockDir);
      } catch {}
    },
    movedTo: (moved) => ownedLock(moved, owner),
  };
}

function reclaimIfStale(lockDir: string, staleMs: number, now: () => number): void {
  let names: string[];
  let aged: boolean;
  try {
    names = readdirSync(lockDir);
    aged = now() - statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return;
  }
  const owners = names.filter((name) => name.startsWith(OWNER_PREFIX));
  if (!aged && !(owners.length > 0 && owners.every(holderIsDead))) return;
  const claims = names.filter((name) => name.startsWith(CLAIM_PREFIX));
  try {
    for (const owner of owners) {
      const claim = uniqueName(CLAIM_PREFIX);
      renameSync(join(lockDir, owner), join(lockDir, claim));
      claims.push(claim);
    }
    for (const claim of claims) unlinkSync(join(lockDir, claim));
    rmdirSync(lockDir);
  } catch {}
}

export function acquireOwnedFileLock(
  lockDir: string,
  options: FileLockOptions = {},
): OwnedFileLock {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 10_000;
  const retryMs = options.retryMs ?? 20;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const deadline = now() + timeoutMs;
  for (let parentMade = false; ; parentMade = true) {
    const taken = tryTakeOwned(lockDir);
    if (taken) return taken;
    if (!parentMade) {
      try {
        mkdirSync(dirname(lockDir), { recursive: true });
      } catch {}
    }
    reclaimIfStale(lockDir, staleMs, now);
    const retaken = tryTakeOwned(lockDir);
    if (retaken) return retaken;
    if (now() >= deadline) throw new FileLockTimeoutError(lockDir, timeoutMs);
    sleep(retryMs);
  }
}

export function withOwnedFileLockSync<T>(
  lockDir: string,
  fn: (lock: OwnedFileLock) => T,
  options: FileLockOptions = {},
): T {
  const lock = acquireOwnedFileLock(lockDir, options);
  try {
    return fn(lock);
  } finally {
    lock.release();
  }
}
