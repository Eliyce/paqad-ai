import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

export const DEDUPE_WINDOW_MS = 10_000;
const TAIL_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 200;
const LOCK_STALE_MS = 60_000;
const LOST_LOCK_RETRIES = 3;
const OWNER_PREFIX = 'owner-';
const CLAIM_PREFIX = 'claim-';

class TailLockLost extends Error {}

function sleepBriefly(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function uniqueName(prefix) {
  return `${prefix}${process.pid}-${randomBytes(6).toString('hex')}`;
}

function holderIsDead(name) {
  const pid = Number(name.slice(OWNER_PREFIX.length).split('-')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

function tryTake(lock) {
  try {
    mkdirSync(lock);
  } catch {
    return null;
  }
  const owner = uniqueName(OWNER_PREFIX);
  try {
    writeFileSync(join(lock, owner), '');
    if (readdirSync(lock).length === 1) return owner;
    unlinkSync(join(lock, owner));
    rmdirSync(lock);
  } catch {}
  return null;
}

function reclaimIfStale(lock) {
  let names;
  let aged;
  try {
    names = readdirSync(lock);
    aged = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return;
  }
  const owners = names.filter((name) => name.startsWith(OWNER_PREFIX));
  if (!aged && !(owners.length > 0 && owners.every(holderIsDead))) return;
  const claims = names.filter((name) => name.startsWith(CLAIM_PREFIX));
  try {
    for (const owner of owners) {
      const claim = uniqueName(CLAIM_PREFIX);
      renameSync(join(lock, owner), join(lock, claim));
      claims.push(claim);
    }
    for (const claim of claims) unlinkSync(join(lock, claim));
    rmdirSync(lock);
  } catch {}
}

function takeWithinWait(lock) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const taken = tryTake(lock);
    if (taken) return taken;
    reclaimIfStale(lock);
    const retaken = tryTake(lock);
    if (retaken) return retaken;
    if (Date.now() >= deadline) return null;
    sleepBriefly(20);
  }
}

function release(lock, owner) {
  try {
    unlinkSync(join(lock, owner));
    rmdirSync(lock);
  } catch {}
}

export function withTailLock(file, fn) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < LOST_LOCK_RETRIES; attempt += 1) {
    const owner = takeWithinWait(lock);
    if (owner === null) break;
    const assertHeld = () => {
      try {
        const at = new Date();
        utimesSync(lock, at, at);
      } catch {}
      if (!existsSync(join(lock, owner))) throw new TailLockLost();
    };
    try {
      return fn(assertHeld);
    } catch (error) {
      if (!(error instanceof TailLockLost)) throw error;
    } finally {
      release(lock, owner);
    }
  }
  return fn(() => {});
}

function readTail(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function seenInTail(file, matches, options = {}) {
  const lines = readTail(file).split('\n');
  const nowMs = (options.now ?? new Date()).getTime();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (!matches(row)) continue;
    if (options.byValue) return true;
    const at = Date.parse(row.at);
    return Number.isFinite(at) && nowMs - at <= DEDUPE_WINDOW_MS;
  }
  return false;
}
