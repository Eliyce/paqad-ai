import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  digestWorkingFile,
  loadChangeEvidence,
  readGitChangedFiles,
} from '@/pipeline/change-evidence.js';

import {
  DELIVERED_FILES,
  commitAll,
  makeEmptyRepo,
  makeRepoWithStaleCache,
  writeChangedFilesCache,
  writeRepoFile,
} from './changed-files.fixture.js';

describe('loadChangeEvidence is git-only', () => {
  const roots: string[] = [];
  function track(root: string): string {
    roots.push(root);
    return root;
  }
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('AC-2: a stale cache with one dirty entry no longer hides the other edited files', async () => {
    const root = track(makeRepoWithStaleCache());
    writeRepoFile(root, DELIVERED_FILES[0]!, 'export const delivered = 2;\n');
    writeRepoFile(root, 'src/other-a.ts', 'export const a = 1;\n');
    writeRepoFile(root, 'src/other-b.ts', 'export const b = 1;\n');

    const result = await loadChangeEvidence(root);

    expect(result).toEqual({
      files: ['src/delivered-a.ts', 'src/other-a.ts', 'src/other-b.ts'],
      source: 'git',
    });
  });

  it('AC-3: edits only committed on the branch (clean tree) are returned', async () => {
    const root = track(makeRepoWithStaleCache());
    writeRepoFile(root, 'src/branch-work.ts', 'export const work = 1;\n');
    writeRepoFile(root, 'tests/branch-work.test.ts', 'it.todo("work");\n');
    commitAll(root, 'branch work');

    const result = await loadChangeEvidence(root);

    expect(result).toEqual({
      files: ['src/branch-work.ts', 'tests/branch-work.test.ts'],
      source: 'git',
    });
  });

  it('AC-3: a file both committed on the branch and dirty again is listed once', async () => {
    const root = track(makeRepoWithStaleCache());
    writeRepoFile(root, 'src/branch-work.ts', 'export const work = 1;\n');
    commitAll(root, 'branch work');
    writeRepoFile(root, 'src/branch-work.ts', 'export const work = 2;\n');

    await expect(readGitChangedFiles(root)).resolves.toEqual(['src/branch-work.ts']);
  });

  it('AC-4: a clean branch with no commits since main is none, never a throw', async () => {
    const root = track(makeRepoWithStaleCache());

    await expect(loadChangeEvidence(root)).resolves.toEqual({ files: [], source: 'none' });
    await expect(readGitChangedFiles(root)).resolves.toEqual([]);
  });

  it('AC-5: a directory that is not a git work tree is none, even with a cache', async () => {
    const root = track(mkdtempSync(join(tmpdir(), 'paqad-646-nogit-')));
    writeChangedFilesCache(root, ['src/a.ts']);

    await expect(loadChangeEvidence(root)).resolves.toEqual({ files: [], source: 'none' });
  });

  it('AC-5: a repo with no main or master reads working-tree status only', async () => {
    const root = track(makeEmptyRepo('develop'));
    writeRepoFile(root, 'src/committed.ts', 'export const committed = 1;\n');
    commitAll(root, 'develop history');
    writeRepoFile(root, 'src/dirty.ts', 'export const dirty = 1;\n');
    writeChangedFilesCache(root, ['src/committed.ts']);

    const result = await loadChangeEvidence(root);

    expect(result).toEqual({ files: ['src/dirty.ts'], source: 'git' });
  });

  it('a repo with no commits at all reads working-tree status only', async () => {
    const root = track(makeEmptyRepo('main'));
    writeRepoFile(root, 'src/first.ts', 'export const first = 1;\n');

    const result = await loadChangeEvidence(root);

    expect(result).toEqual({ files: ['.gitignore', 'src/first.ts'], source: 'git' });
  });
});

describe('loadChangeEvidence measured from the change start point (hud-live-run-truth)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('AC-8: leaves out earlier commits and files already dirty when the change opened', async () => {
    const root = makeRepoWithStaleCache();
    roots.push(root);
    writeRepoFile(root, 'src/earlier.ts', 'export const earlier = 1;\n');
    commitAll(root, 'earlier work');
    writeRepoFile(root, 'local-dirt.txt', 'untracked before open\n');
    const start = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      worktree: { 'local-dirt.txt': digestWorkingFile(root, 'local-dirt.txt')! },
    };

    expect((await loadChangeEvidence(root)).files).toContain('src/earlier.ts');
    expect(await loadChangeEvidence(root, { since: start })).toEqual({ files: [], source: 'none' });

    writeRepoFile(root, 'src/mine.ts', 'export const mine = 1;\n');
    expect((await loadChangeEvidence(root, { since: start })).files).toEqual(['src/mine.ts']);
  });
});
