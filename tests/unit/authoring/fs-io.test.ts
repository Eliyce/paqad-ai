import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isMissingPathError,
  openIfPresent,
  readRegularFile,
  readTextIfPresent,
  tempPathFor,
  writeFileAtomic,
} from '@/authoring/fs-io.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-authoring-fs-io-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('authoring file io', () => {
  it('treats a missing file or a file used as a folder as absent', () => {
    writeFileSync(join(root, 'plain.txt'), 'hello');
    expect(readTextIfPresent(join(root, 'missing.txt'))).toBeNull();
    expect(readTextIfPresent(join(root, 'plain.txt', 'child.txt'))).toBeNull();
    expect(openIfPresent(join(root, 'missing.txt'))).toBeNull();
    expect(readTextIfPresent(join(root, 'plain.txt'))).toBe('hello');
    expect(isMissingPathError({ code: 'EACCES' })).toBe(false);
    expect(isMissingPathError(null)).toBe(false);
  });

  it('rethrows any other open error', () => {
    mkdirSync(join(root, 'folder'));
    expect(() => openIfPresent(join(root, 'folder'), 'w')).toThrow(/EISDIR/u);
  });

  it('reads a regular file with its mode and returns null for a folder', () => {
    writeFileSync(join(root, 'data.bin'), Buffer.from([1, 0, 2]));
    mkdirSync(join(root, 'folder'));
    const file = readRegularFile(join(root, 'data.bin'));
    expect(file?.buffer).toEqual(Buffer.from([1, 0, 2]));
    expect(file?.mode).toBe(statSync(join(root, 'data.bin')).mode & 0o7777);
    expect(readRegularFile(join(root, 'folder'))).toBeNull();
    expect(() => readRegularFile(join(root, 'missing.bin'))).toThrow(/ENOENT/u);
  });

  it.skipIf(process.platform === 'win32')('refuses to follow a symlink when asked not to', () => {
    writeFileSync(join(root, 'real.txt'), 'real');
    symlinkSync('real.txt', join(root, 'link.txt'));
    expect(readRegularFile(join(root, 'link.txt'))?.buffer.toString()).toBe('real');
    expect(() => readRegularFile(join(root, 'link.txt'), false)).toThrow();
  });

  it('replaces a file through a temp file and leaves no temp file behind', () => {
    const target = join(root, 'ledger.jsonl');
    writeFileSync(target, 'old\n');
    writeFileAtomic(target, 'new\n');
    expect(readFileSync(target, 'utf8')).toBe('new\n');
    writeFileAtomic(join(root, 'bytes.bin'), Buffer.from([0, 1]), 0o600);
    expect(readFileSync(join(root, 'bytes.bin'))).toEqual(Buffer.from([0, 1]));
    if (process.platform !== 'win32') {
      expect(statSync(join(root, 'bytes.bin')).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(root).sort()).toEqual(['bytes.bin', 'ledger.jsonl']);
  });

  it('removes the temp file when the rename fails', () => {
    const target = join(root, 'busy');
    mkdirSync(join(target, 'inner'), { recursive: true });
    expect(() => writeFileAtomic(target, 'text')).toThrow();
    expect(readdirSync(root)).toEqual(['busy']);
    expect(tempPathFor(target)).toBe(join(root, `.busy.${process.pid}.tmp`));
  });
});
