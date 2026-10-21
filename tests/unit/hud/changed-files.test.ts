import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GIT_READ_TIMEOUT_MS, readChangedFiles } from '@/hud/changed-files.js';

import {
  checkout,
  cleanupScopeFixtures,
  commit,
  git,
  plainRoot,
  repoRoot,
} from './scope-fixtures.js';

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return { ...real, execFileSync: vi.fn(real.execFileSync) };
});

const realExec = vi.mocked(execFileSync).getMockImplementation()!;

afterEach(() => {
  vi.mocked(execFileSync).mockImplementation(realExec);
  vi.mocked(execFileSync).mockClear();
  cleanupScopeFixtures();
});

const noError = () => {
  throw new Error('no read error was expected');
};

describe('AC-27: the files this change touched', () => {
  it('lists committed, edited, staged and untracked files once each, leaving .paqad out', () => {
    const root = repoRoot();
    checkout(root, 'feat/x', true);
    commit(root, 'a.ts', 'feat: a');
    writeFileSync(join(root, 'README.md'), 'edited\n');
    writeFileSync(join(root, 'b.ts'), 'staged\n');
    git(root, 'add', 'b.ts');
    writeFileSync(join(root, 'c d.ts'), 'untracked\n');
    mkdirSync(join(root, '.paqad', 'decisions'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'decisions', 'index.json'), '{}\n');
    git(root, 'add', '-f', '.paqad/decisions/index.json');
    mkdirSync(join(root, 'pkg', '.paqad'), { recursive: true });
    writeFileSync(join(root, 'pkg', '.paqad', 'state.json'), '{}\n');
    commit(root, 'a.ts', 'feat: a again');

    expect(readChangedFiles(root, 'main', noError)).toEqual([
      'README.md',
      'a.ts',
      'b.ts',
      'c d.ts',
    ]);
  });

  it('reads against the policy base branch, and falls back to main or master', () => {
    const root = repoRoot('trunk');
    checkout(root, 'feat/y', true);
    commit(root, 'y.ts', 'feat: y');
    expect(readChangedFiles(root, 'trunk', noError)).toEqual(['y.ts']);
    expect(readChangedFiles(root, null, noError)).toBeNull();
    git(root, 'branch', 'main', 'trunk');
    expect(readChangedFiles(root, 'develop', noError)).toEqual(['y.ts']);
  });

  it('is null outside git, with nothing logged', () => {
    expect(readChangedFiles(plainRoot(), 'main', noError)).toBeNull();
  });

  it('bounds every read, and is null with the failure passed on when git fails', () => {
    const root = repoRoot();
    checkout(root, 'feat/z', true);
    commit(root, 'z.ts', 'feat: z');
    expect(readChangedFiles(root, 'main', noError)).toEqual(['z.ts']);
    const reads = vi
      .mocked(execFileSync)
      .mock.calls.filter(
        ([, args]) => Array.isArray(args) && ['diff', 'ls-files'].includes(args[0]!),
      );
    expect(reads).toHaveLength(2);
    for (const [, , options] of reads) {
      expect(options).toMatchObject({ timeout: GIT_READ_TIMEOUT_MS });
    }

    vi.mocked(execFileSync).mockImplementation(((command, args, options) => {
      if (Array.isArray(args) && args[0] === 'diff') throw new Error('git timed out');
      return realExec(command, args, options);
    }) as typeof execFileSync);
    const errors: unknown[] = [];
    expect(readChangedFiles(root, 'main', (error) => errors.push(error))).toBeNull();
    expect(errors.map((error) => (error as Error).message)).toEqual(['git timed out']);
  });
});
