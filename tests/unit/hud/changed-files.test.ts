import { execFileSync } from 'node:child_process';
import { mkdirSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readChangeStartPoint,
  readFeatureDelivery,
  writeFeatureDelivery,
} from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  GIT_READ_TIMEOUT_MS,
  NEW_FILE_MAX_BYTES,
  NEW_FILES_PER_SNAPSHOT,
  NUL_PROBE_BYTES,
  clearChangeDiffCache,
  readChangeDiff,
  readChangeGit,
} from '@/hud/changed-files.js';

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

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, readSync: vi.fn(real.readSync) };
});

const realExec = vi.mocked(execFileSync).getMockImplementation()!;

afterEach(() => {
  vi.mocked(execFileSync).mockImplementation(realExec);
  vi.mocked(execFileSync).mockClear();
  vi.mocked(readSync).mockClear();
  clearChangeDiffCache();
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
    git(root, 'commit', '-q', '-m', 'feat: earlier work');
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

  it('leaves out what a later merge of the base branch brought in', () => {
    const root = repoRoot();
    checkout(root, 'feat/merged', true);
    const dir = open(root);
    commit(root, 'mine.ts', 'feat: mine');
    checkout(root, 'main');
    commit(root, 'theirs.ts', 'feat: theirs');
    checkout(root, 'feat/merged');
    git(root, 'merge', '-q', '--no-edit', 'main');
    writeFileSync(join(root, 'edited.ts'), 'after the merge\n');

    const start = readChangeStartPoint(root, dir, 'main')!;
    expect(start.commit).toBe(git(root, 'rev-parse', 'main'));
    expect(readChangeGit(root, 'main', noError, start)!.files).toEqual(['edited.ts', 'mine.ts']);
  });

  it('leaves out a later base merge on a branch that already had earlier work', () => {
    const root = repoRoot();
    checkout(root, 'feat/earlier', true);
    commit(root, 'earlier.ts', 'feat: earlier work');
    const dir = open(root);
    commit(root, 'mine.ts', 'feat: mine');
    checkout(root, 'main');
    commit(root, 'theirs.ts', 'feat: theirs');
    checkout(root, 'feat/earlier');
    git(root, 'merge', '-q', '--no-edit', 'main');

    const start = readChangeStartPoint(root, dir, 'main')!;
    expect(readChangeGit(root, 'main', noError, start)!.files).toEqual(['mine.ts']);
  });

  it('keeps the start commit when the base branch moved on without being merged', () => {
    const root = repoRoot();
    checkout(root, 'feat/apart', true);
    const dir = open(root);
    const opened = git(root, 'rev-parse', 'HEAD');
    commit(root, 'mine.ts', 'feat: mine');
    checkout(root, 'main');
    commit(root, 'theirs.ts', 'feat: theirs');
    checkout(root, 'feat/apart');

    expect(readChangeStartPoint(root, dir, 'main')).toMatchObject({ commit: opened });
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

describe('#836 ship.diff: lines added and removed by the change (FR-1 to FR-7)', () => {
  const at = (root: string) => ({
    commit: git(root, 'rev-parse', 'HEAD'),
    worktree: null,
    source: 'start_commit' as const,
    base: null,
  });
  const diffOf = (root: string, start: ReturnType<typeof at>, files: string[]) =>
    readChangeDiff(root, start, files, noError);
  const gitCalls = (verb: string) =>
    vi
      .mocked(execFileSync)
      .mock.calls.filter(([, args]) => Array.isArray(args) && args[0] === verb);

  it('counts edited tracked files, uncommitted and committed, and new files from disk', () => {
    const root = repoRoot();
    writeFileSync(join(root, 'tracked.ts'), 'one\ntwo\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'tracked');
    const start = at(root);
    writeFileSync(join(root, 'tracked.ts'), 'one\nTWO\nthree\n');
    commit(root, 'committed.ts', 'feat: committed');
    writeFileSync(join(root, 'new.ts'), 'a\nb\nc\n');
    writeFileSync(join(root, 'open.ts'), 'a\nb\nc');
    writeFileSync(join(root, 'empty.ts'), '');
    expect(
      diffOf(root, start, ['committed.ts', 'empty.ts', 'new.ts', 'open.ts', 'tracked.ts']),
    ).toEqual({ additions: 1 + 2 + 3 + 3, deletions: 1, partial: false });
  });

  it('AC-1: a tracked file edited and then reverted adds zero lines', () => {
    const root = repoRoot();
    writeFileSync(join(root, 'kept.ts'), 'one\ntwo\nthree\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'kept');
    const start = at(root);
    writeFileSync(join(root, 'kept.ts'), 'changed\n');
    writeFileSync(join(root, 'kept.ts'), 'one\ntwo\nthree\n');
    expect(diffOf(root, start, ['kept.ts'])).toEqual({
      additions: 0,
      deletions: 0,
      partial: false,
    });
  });

  it('AC-2: only an untracked file in the changed-files list counts', () => {
    const root = repoRoot();
    const start = at(root);
    writeFileSync(join(root, 'listed.ts'), 'a\nb\n');
    writeFileSync(join(root, 'stray.ts'), 'a\nb\nc\nd\n');
    expect(diffOf(root, start, ['listed.ts'])).toEqual({
      additions: 2,
      deletions: 0,
      partial: false,
    });
  });

  it('AC-3: counts a 1 MiB file, skips a larger one and a NUL file without a full read', () => {
    const root = repoRoot();
    const start = at(root);
    writeFileSync(join(root, 'exact.txt'), Buffer.alloc(NEW_FILE_MAX_BYTES, 0x0a));
    writeFileSync(join(root, 'over.txt'), Buffer.alloc(NEW_FILE_MAX_BYTES + 1, 0x0a));
    const binary = Buffer.alloc(NUL_PROBE_BYTES * 4, 0x0a);
    binary[100] = 0;
    writeFileSync(join(root, 'binary.bin'), binary);
    expect(diffOf(root, start, ['binary.bin', 'exact.txt', 'over.txt'])).toEqual({
      additions: NEW_FILE_MAX_BYTES,
      deletions: 0,
      partial: false,
    });
    const lengths = vi.mocked(readSync).mock.calls.map((call) => call[3] as number);
    expect(lengths).toContain(NUL_PROBE_BYTES);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(
      NEW_FILE_MAX_BYTES + NUL_PROBE_BYTES,
    );
  });

  it('counts a renamed and edited file once under its new name, and a binary change as 0', () => {
    const root = repoRoot();
    writeFileSync(join(root, 'old.ts'), 'a\nb\nc\nd\ne\nf\n');
    writeFileSync(join(root, 'pic.bin'), Buffer.from([0, 1, 2, 3]));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    const start = at(root);
    git(root, 'mv', 'old.ts', 'new.ts');
    writeFileSync(join(root, 'new.ts'), 'a\nb\nc\nd\ne\nf\ng\n');
    writeFileSync(join(root, 'pic.bin'), Buffer.from([0, 9, 9, 9, 9]));
    git(root, 'add', '-A');
    expect(diffOf(root, start, ['new.ts', 'pic.bin'])).toEqual({
      additions: 1,
      deletions: 0,
      partial: false,
    });
  });

  it('leaves out .paqad, merged-in and dirty-at-start files through the changed-files list', () => {
    const root = repoRoot();
    checkout(root, 'feat/diff', true);
    const dir = openFeatureChange(root, 'ses-diff', {
      adapter: 'claude-code',
      title: 'diff change',
      issue: null,
      lane: 'full',
    });
    commit(root, 'mine.ts', 'feat: mine');
    checkout(root, 'main');
    commit(root, 'theirs.ts', 'feat: theirs');
    checkout(root, 'feat/diff');
    git(root, 'merge', '-q', '--no-edit', 'main');
    const start = readChangeStartPoint(root, dir, 'main')!;
    const listed = readChangeGit(root, 'main', noError, start)!.files;
    expect(listed).toEqual(['mine.ts']);
    expect(readChangeDiff(root, start, listed, noError)).toEqual({
      additions: 1,
      deletions: 0,
      partial: false,
    });
  });

  it('matches the changed-files list for a project in a subfolder of the repo', () => {
    const root = repoRoot();
    mkdirSync(join(root, 'app'));
    const start = at(root);
    writeFileSync(join(root, 'app', 'inner.ts'), 'x\ny\n');
    writeFileSync(join(root, 'README.md'), 'changed above\n');
    git(root, 'add', 'README.md');
    expect(readChangeDiff(join(root, 'app'), start, ['inner.ts'], noError)).toEqual({
      additions: 2,
      deletions: 0,
      partial: false,
    });
  });

  it('AC-4: is null with no start point or file list, and null with onError when git fails', () => {
    const root = repoRoot();
    const start = at(root);
    expect(readChangeDiff(root, null, ['a.ts'], noError)).toBeNull();
    expect(readChangeDiff(root, start, null, noError)).toBeNull();
    vi.mocked(execFileSync).mockImplementation(((command, args, options) => {
      if (Array.isArray(args) && args[0] === 'diff') throw new Error('git timed out');
      return realExec(command, args, options);
    }) as typeof execFileSync);
    const errors: unknown[] = [];
    expect(readChangeDiff(root, start, ['a.ts'], (error) => errors.push(error))).toBeNull();
    expect(errors.map((error) => (error as Error).message)).toEqual(['git timed out']);
  });

  it('FR-5: runs ls-files only when a listed path is missing from numstat, bounded by the timeout', () => {
    const root = repoRoot();
    const start = at(root);
    writeFileSync(join(root, 'README.md'), 'edited\n');
    diffOf(root, start, ['README.md']);
    expect(gitCalls('ls-files')).toHaveLength(0);
    for (const [, , options] of gitCalls('diff')) {
      expect(options).toMatchObject({ timeout: GIT_READ_TIMEOUT_MS });
    }
    writeFileSync(join(root, 'gone.ts'), 'x\n');
    diffOf(root, start, ['README.md', 'gone.ts']);
    expect(gitCalls('ls-files')).toHaveLength(1);
  });

  it('FR-6: does not re-read an unchanged new file, and re-reads it after an edit', () => {
    const root = repoRoot();
    const start = at(root);
    writeFileSync(join(root, 'cached.ts'), 'a\nb\n');
    expect(diffOf(root, start, ['cached.ts'])?.additions).toBe(2);
    const reads = vi.mocked(readSync).mock.calls.length;
    expect(diffOf(root, start, ['cached.ts'])?.additions).toBe(2);
    expect(vi.mocked(readSync).mock.calls.length).toBe(reads);
    writeFileSync(join(root, 'cached.ts'), 'a\nb\nc\nd\ne\n');
    expect(diffOf(root, start, ['cached.ts'])?.additions).toBe(5);
  });

  it('AC-5: past the per-snapshot cap the count is partial', () => {
    const root = repoRoot();
    const start = at(root);
    mkdirSync(join(root, 'many'));
    const names: string[] = [];
    for (let index = 0; index < NEW_FILES_PER_SNAPSHOT + 3; index += 1) {
      const name = `many/f${String(index).padStart(4, '0')}.ts`;
      writeFileSync(join(root, name), 'line\n');
      names.push(name);
    }
    expect(diffOf(root, start, names)).toEqual({
      additions: NEW_FILES_PER_SNAPSHOT,
      deletions: 0,
      partial: true,
    });
    expect(diffOf(root, start, names)).toEqual({
      additions: NEW_FILES_PER_SNAPSHOT + 3,
      deletions: 0,
      partial: false,
    });
  });
});
