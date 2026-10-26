import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readChangeStartPoint,
  readFeatureDelivery,
  writeFeatureDelivery,
} from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { GIT_READ_TIMEOUT_MS, readChangeGit } from '@/hud/changed-files.js';

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

const files = (root: string, base: string | null) => readChangeGit(root, base, noError)?.files;

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

    expect(files(root, 'main')).toEqual(['README.md', 'a.ts', 'b.ts', 'c d.ts']);
  });

  it('reads against the policy base branch, and falls back to main or master', () => {
    const root = repoRoot('trunk');
    checkout(root, 'feat/y', true);
    commit(root, 'y.ts', 'feat: y');
    expect(files(root, 'trunk')).toEqual(['y.ts']);
    expect(readChangeGit(root, null, noError)).toBeNull();
    git(root, 'branch', 'main', 'trunk');
    expect(files(root, 'develop')).toEqual(['y.ts']);
  });

  it('is null outside git, with nothing logged', () => {
    expect(readChangeGit(plainRoot(), 'main', noError)).toBeNull();
  });

  it('keeps the commit time of each commit since the base, for the Record', () => {
    const root = repoRoot();
    const onMain = git(root, 'rev-parse', 'HEAD');
    checkout(root, 'feat/times', true);
    const first = commit(root, 'one.ts', 'feat: one');
    const second = commit(root, 'two.ts', 'feat: two');
    const times = readChangeGit(root, 'main', noError)!.commitTimes;
    expect([...times.keys()].sort()).toEqual([first, second].sort());
    expect(times.has(onMain)).toBe(false);
    expect(Number.isFinite(Date.parse(times.get(first)!))).toBe(true);
  });

  it('bounds every read, and is null with the failure passed on when git fails', () => {
    const root = repoRoot();
    checkout(root, 'feat/z', true);
    commit(root, 'z.ts', 'feat: z');
    expect(files(root, 'main')).toEqual(['z.ts']);
    const reads = vi
      .mocked(execFileSync)
      .mock.calls.filter(
        ([, args]) => Array.isArray(args) && ['diff', 'ls-files', 'log'].includes(args[0]!),
      );
    expect(reads).toHaveLength(3);
    for (const [, , options] of reads) {
      expect(options).toMatchObject({ timeout: GIT_READ_TIMEOUT_MS });
    }

    vi.mocked(execFileSync).mockImplementation(((command, args, options) => {
      if (Array.isArray(args) && args[0] === 'log') return 'nonsense\0';
      return realExec(command, args, options);
    }) as typeof execFileSync);
    expect(readChangeGit(root, 'main', noError)?.commitTimes.size).toBe(0);

    vi.mocked(execFileSync).mockImplementation(((command, args, options) => {
      if (Array.isArray(args) && args[0] === 'diff') throw new Error('git timed out');
      return realExec(command, args, options);
    }) as typeof execFileSync);
    const errors: unknown[] = [];
    expect(readChangeGit(root, 'main', (error) => errors.push(error))).toBeNull();
    expect(errors.map((error) => (error as Error).message)).toEqual(['git timed out']);
  });
});

describe('AC-8 / AC-9 / AC-26: files and commits are measured from where the change started', () => {
  function branchWithEarlierWork(): string {
    const root = repoRoot();
    writeFileSync(join(root, 'gone.ts'), 'tracked\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'chore: gone');
    checkout(root, 'release', true);
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(join(root, `earlier-${index}.ts`), `${index}\n`);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'feat: earlier work (#1234)');
    for (let index = 6; index < 11; index += 1) {
      writeFileSync(join(root, `earlier-${index}.ts`), `${index}\n`);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fix: more earlier work');
    checkout(root, 'feat/next', true);
    writeFileSync(join(root, '.worktreeinclude'), 'local\n');
    rmSync(join(root, 'gone.ts'));
    return root;
  }

  function open(root: string): string {
    return openFeatureChange(root, 'ses-start', {
      adapter: 'claude-code',
      title: 'next change',
      issue: null,
      lane: 'full',
    });
  }

  it('reads nothing right after the change opens, then only what the change edits', () => {
    const root = branchWithEarlierWork();
    const dir = open(root);
    const start = readChangeStartPoint(root, dir, 'main')!;
    expect(start).toMatchObject({ source: 'start_commit', base: null });
    expect(start.worktree).toMatchObject({
      '.worktreeinclude': expect.any(String),
      'gone.ts': 'deleted',
    });

    expect(readChangeGit(root, 'main', noError)?.files).toHaveLength(13);
    const atOpen = readChangeGit(root, 'main', noError, start)!;
    expect(atOpen.files).toEqual([]);
    expect(atOpen.commitTimes.size).toBe(0);

    writeFileSync(join(root, 'mine.ts'), 'this change\n');
    expect(readChangeGit(root, 'main', noError, start)!.files).toEqual(['mine.ts']);
    writeFileSync(join(root, '.worktreeinclude'), 'touched again\n');
    expect(readChangeGit(root, 'main', noError, start)!.files).toEqual([
      '.worktreeinclude',
      'mine.ts',
    ]);
  });

  it('falls back to the fork point, then the named base, when the start commit is lost', () => {
    const root = branchWithEarlierWork();
    const dir = open(root);
    const delivery = readFeatureDelivery(root, dir);
    writeFeatureDelivery(root, dir, { ...delivery, start_commit: '0'.repeat(40) });
    expect(readChangeStartPoint(root, dir, 'main')).toMatchObject({
      source: 'fork-point',
      base: 'release',
    });
    git(root, 'reflog', 'expire', '--expire=all', '--all');
    expect(readChangeStartPoint(root, dir, 'main')).toMatchObject({
      source: 'fallback-base',
      base: 'main',
    });
  });

  it('bundles opened before the start tree was recorded say the starting files are unknown', () => {
    const root = branchWithEarlierWork();
    const dir = open(root);
    const delivery = readFeatureDelivery(root, dir);
    writeFeatureDelivery(root, dir, { ...delivery, start_worktree: null });
    expect(readChangeStartPoint(root, dir, 'main')?.worktree).toBeNull();
  });
});
