import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { releaseFileLock, tryAcquireFileLock } from '@/background/single-flight-lock.js';

import { withTempDir } from '../skills/_helpers/temp-fs.js';

interface Holder {
  pid: number;
}

const parse = (text: string): Holder | null => {
  try {
    const value = JSON.parse(text) as Holder;
    return Number.isInteger(value.pid) ? value : null;
  } catch {
    return null;
  }
};

const same = (a: Holder, b: Holder) => a.pid === b.pid;

describe('file lock on a path that is not a plain file (AC-29)', () => {
  it.skipIf(process.platform === 'win32')(
    'AC-29 never follows a symlinked lock path and reports no holder',
    () => {
      withTempDir((dir) => {
        const target = join(dir, 'elsewhere.json');
        writeFileSync(target, JSON.stringify({ pid: 4 }));
        const path = join(dir, 'heavy.json');
        symlinkSync(target, path);
        const outcome = tryAcquireFileLock<Holder>(path, {
          body: { pid: 1 },
          parse,
          holderGone: () => true,
        });
        expect(outcome).toEqual({ acquired: false, holder: null });
        expect(parse(readFileSync(target, 'utf8'))).toEqual({ pid: 4 });
      });
    },
  );

  it('AC-29 treats a directory at the lock path as held by no one it can name', () => {
    withTempDir((dir) => {
      const path = join(dir, 'heavy.json');
      mkdirSync(path);
      expect(
        tryAcquireFileLock<Holder>(path, { body: { pid: 1 }, parse, holderGone: () => true }),
      ).toEqual({ acquired: false, holder: null });
    });
  });
});

describe('file lock races (AC-29)', () => {
  it('AC-29 gives up when the judged lock vanishes before it can be set aside', () => {
    withTempDir((dir) => {
      const path = join(dir, 'heavy.json');
      writeFileSync(path, JSON.stringify({ pid: 9 }));
      const outcome = tryAcquireFileLock<Holder>(path, {
        body: { pid: 1 },
        parse,
        holderGone: () => {
          rmSync(path);
          return true;
        },
      });
      expect(outcome).toEqual({ acquired: false, holder: null });
      expect(existsSync(path)).toBe(false);
    });
  });

  it('AC-29 releases only its own lock and does nothing once the lock is gone', () => {
    withTempDir((dir) => {
      const path = join(dir, 'heavy.json');
      writeFileSync(path, JSON.stringify({ pid: 5 }));
      releaseFileLock(path, { pid: 1 }, parse, same);
      expect(existsSync(path)).toBe(true);
      releaseFileLock(path, { pid: 5 }, parse, same);
      expect(existsSync(path)).toBe(false);
      expect(() => releaseFileLock(path, { pid: 5 }, parse, same)).not.toThrow();
    });
  });
});
