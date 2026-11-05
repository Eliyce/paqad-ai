import { closeSync, fstatSync, mkdirSync, openSync, readSync, rmdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEDUPE_WINDOW_MS = 10_000;
const TAIL_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 200;
const LOCK_STALE_MS = 2_000;

function sleepBriefly(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withTailLock(file, fn) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      mkdirSync(lock);
      held = true;
    } catch {
      let stale = false;
      try {
        stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
      } catch {}
      let removed = false;
      if (stale) {
        try {
          rmdirSync(lock);
          removed = true;
        } catch {}
      }
      if (Date.now() >= deadline) break;
      if (!removed) sleepBriefly(20);
    }
  }
  try {
    return fn();
  } finally {
    if (held) {
      try {
        rmdirSync(lock);
      } catch {}
    }
  }
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
