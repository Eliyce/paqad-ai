import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);
const READ_NO_FOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && MISSING_CODES.has(code);
}

export function openIfPresent(path: string, flags: string | number = 'r'): number | null {
  try {
    return openSync(path, flags);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export function readTextIfPresent(path: string): string | null {
  const fd = openIfPresent(path);
  if (fd === null) return null;
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function readBytesIfPresent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export interface RegularFile {
  buffer: Buffer;
  mode: number;
}

export function readRegularFile(path: string, followLinks = true): RegularFile | null {
  let fd: number;
  try {
    fd = openSync(path, followLinks ? constants.O_RDONLY : READ_NO_FOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'EISDIR') return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    return stat.isFile() ? { buffer: readFileSync(fd), mode: stat.mode & 0o7777 } : null;
  } finally {
    closeSync(fd);
  }
}

export function tempPathFor(path: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
}

export function writeFileAtomic(path: string, content: string | Uint8Array, mode?: number): void {
  const tmp = tempPathFor(path);
  try {
    writeFileSync(tmp, content, typeof content === 'string' ? 'utf8' : undefined);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameWithRetrySync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
