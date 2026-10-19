import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RENAME_MAX_ATTEMPTS,
  renameWithRetry,
  renameWithRetrySync,
} from '@/core/fs/atomic-rename.js';

function codeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: rename failed`), { code });
}

describe('atomic-rename (issue #647)', () => {
  let dir: string;
  let from: string;
  let to: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-atomic-rename-'));
    from = join(dir, 'target.json.tmp');
    to = join(dir, 'target.json');
    writeFileSync(from, '{"ok":true}\n', 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('renameWithRetry (async)', () => {
    it('renames for real with the default seams', async () => {
      await renameWithRetry(from, to);
      expect(existsSync(from)).toBe(false);
      expect(readFileSync(to, 'utf8')).toBe('{"ok":true}\n');
    });

    it('AC-1: EPERM twice then success completes after 3 attempts on win32', async () => {
      let calls = 0;
      const waits: number[] = [];
      await renameWithRetry(from, to, {
        platform: 'win32',
        rename: async () => {
          calls += 1;
          if (calls <= 2) throw codeError('EPERM');
        },
        sleep: async (ms) => {
          waits.push(ms);
        },
      });
      expect(calls).toBe(3);
      expect(waits).toEqual([10, 20]);
    });

    it.each(['EPERM', 'EACCES', 'EBUSY'])(
      'AC-2: %s every time rethrows after 5 attempts and removes the temp file',
      async (code) => {
        let calls = 0;
        const waits: number[] = [];
        await expect(
          renameWithRetry(from, to, {
            platform: 'win32',
            rename: async () => {
              calls += 1;
              throw codeError(code);
            },
            sleep: async (ms) => {
              waits.push(ms);
            },
          }),
        ).rejects.toMatchObject({ code });
        expect(calls).toBe(RENAME_MAX_ATTEMPTS);
        expect(waits).toEqual([10, 20, 40, 80]);
        expect(existsSync(from)).toBe(false);
        expect(existsSync(to)).toBe(false);
      },
    );

    it('AC-3: ENOENT is rethrown after one attempt with no wait', async () => {
      let calls = 0;
      const waits: number[] = [];
      await expect(
        renameWithRetry(from, to, {
          platform: 'win32',
          rename: async () => {
            calls += 1;
            throw codeError('ENOENT');
          },
          sleep: async (ms) => {
            waits.push(ms);
          },
        }),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(calls).toBe(1);
      expect(waits).toEqual([]);
      expect(existsSync(from)).toBe(false);
    });

    it('AC-3: EPERM on linux is rethrown after one attempt with no wait', async () => {
      let calls = 0;
      const waits: number[] = [];
      await expect(
        renameWithRetry(from, to, {
          platform: 'linux',
          rename: async () => {
            calls += 1;
            throw codeError('EPERM');
          },
          sleep: async (ms) => {
            waits.push(ms);
          },
        }),
      ).rejects.toMatchObject({ code: 'EPERM' });
      expect(calls).toBe(1);
      expect(waits).toEqual([]);
    });

    it('rethrows a non-errno error at once', async () => {
      let calls = 0;
      await expect(
        renameWithRetry(from, to, {
          platform: 'win32',
          rename: async () => {
            calls += 1;
            throw null;
          },
        }),
      ).rejects.toBeNull();
      expect(calls).toBe(1);
    });

    it('waits with the real timer between retries', async () => {
      let calls = 0;
      await renameWithRetry(from, to, {
        platform: 'win32',
        rename: async () => {
          calls += 1;
          if (calls === 1) throw codeError('EBUSY');
        },
      });
      expect(calls).toBe(2);
    });

    it('keeps the rename error when removing the temp file fails too', async () => {
      await expect(
        renameWithRetry(from, to, {
          platform: 'linux',
          rename: async () => {
            throw codeError('EXDEV');
          },
          remove: async () => {
            throw codeError('EPERM');
          },
        }),
      ).rejects.toMatchObject({ code: 'EXDEV' });
    });
  });

  describe('renameWithRetrySync', () => {
    it('renames for real with the default seams', () => {
      renameWithRetrySync(from, to);
      expect(existsSync(from)).toBe(false);
      expect(readFileSync(to, 'utf8')).toBe('{"ok":true}\n');
    });

    it('AC-1: EPERM twice then success completes after 3 attempts on win32', () => {
      let calls = 0;
      const waits: number[] = [];
      renameWithRetrySync(from, to, {
        platform: 'win32',
        rename: () => {
          calls += 1;
          if (calls <= 2) throw codeError('EPERM');
        },
        sleep: (ms) => {
          waits.push(ms);
        },
      });
      expect(calls).toBe(3);
      expect(waits).toEqual([10, 20]);
    });

    it.each(['EPERM', 'EACCES', 'EBUSY'])(
      'AC-2: %s every time rethrows after 5 attempts and removes the temp file',
      (code) => {
        let calls = 0;
        const waits: number[] = [];
        expect(() =>
          renameWithRetrySync(from, to, {
            platform: 'win32',
            rename: () => {
              calls += 1;
              throw codeError(code);
            },
            sleep: (ms) => {
              waits.push(ms);
            },
          }),
        ).toThrow(expect.objectContaining({ code }));
        expect(calls).toBe(RENAME_MAX_ATTEMPTS);
        expect(waits).toEqual([10, 20, 40, 80]);
        expect(existsSync(from)).toBe(false);
        expect(existsSync(to)).toBe(false);
      },
    );

    it('AC-3: ENOENT is rethrown after one attempt with no wait', () => {
      let calls = 0;
      const waits: number[] = [];
      expect(() =>
        renameWithRetrySync(from, to, {
          platform: 'win32',
          rename: () => {
            calls += 1;
            throw codeError('ENOENT');
          },
          sleep: (ms) => {
            waits.push(ms);
          },
        }),
      ).toThrow(expect.objectContaining({ code: 'ENOENT' }));
      expect(calls).toBe(1);
      expect(waits).toEqual([]);
      expect(existsSync(from)).toBe(false);
    });

    it('AC-3: EPERM on linux is rethrown after one attempt with no wait', () => {
      let calls = 0;
      const waits: number[] = [];
      expect(() =>
        renameWithRetrySync(from, to, {
          platform: 'linux',
          rename: () => {
            calls += 1;
            throw codeError('EPERM');
          },
          sleep: (ms) => {
            waits.push(ms);
          },
        }),
      ).toThrow(expect.objectContaining({ code: 'EPERM' }));
      expect(calls).toBe(1);
      expect(waits).toEqual([]);
    });

    it('rethrows a real ENOENT from the default rename at once', () => {
      expect(() => renameWithRetrySync(join(dir, 'missing.tmp'), to)).toThrow(
        expect.objectContaining({ code: 'ENOENT' }),
      );
    });

    it('waits with the real blocking sleep between retries', () => {
      let calls = 0;
      renameWithRetrySync(from, to, {
        platform: 'win32',
        rename: () => {
          calls += 1;
          if (calls === 1) throw codeError('EACCES');
        },
      });
      expect(calls).toBe(2);
    });

    it('keeps the rename error when removing the temp file fails too', () => {
      expect(() =>
        renameWithRetrySync(from, to, {
          platform: 'linux',
          rename: () => {
            throw codeError('EXDEV');
          },
          remove: () => {
            throw codeError('EPERM');
          },
        }),
      ).toThrow(expect.objectContaining({ code: 'EXDEV' }));
    });
  });
});
