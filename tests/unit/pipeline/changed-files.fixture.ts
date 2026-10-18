import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execaSync } from 'execa';

// Issue #544 / #646 fixtures: a real git repo on a feature branch off `main`, so the
// git-only changed-file reader engages exactly as it does in a developer's checkout.

/** The files an earlier, already-merged change left in the session cache. */
export const DELIVERED_FILES = ['src/delivered-a.ts', 'src/delivered-b.ts'];

/**
 * Where the retired session cache used to live. paqad no longer reads it (issue #646);
 * the fixtures still write one so tests prove a leftover copy changes nothing.
 */
export const STALE_CACHE_PATH = '.paqad/session/changed-files.json';

export function git(root: string, args: string[]): void {
  execaSync('git', args, { cwd: root });
}

export function writeRepoFile(root: string, relPath: string, content: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** Write the retired `.paqad/session/changed-files.json` cache as a bare array. */
export function writeChangedFilesCache(root: string, files: unknown): void {
  writeRepoFile(root, STALE_CACHE_PATH, JSON.stringify(files));
}

/** Commit everything in the working tree on the current branch. */
export function commitAll(root: string, message: string): void {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}

/** An empty repo on `branch` with a committer configured and `.paqad/` git-ignored. */
export function makeEmptyRepo(branch = 'main'): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-646-'));
  git(root, ['init', '-q', '-b', branch]);
  git(root, ['config', 'user.email', 'test@paqad.dev']);
  git(root, ['config', 'user.name', 'paqad test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeRepoFile(root, '.gitignore', '.paqad/\n');
  return root;
}

/**
 * A repo whose `main` already holds `delivered` (committed and clean), checked out
 * on a fresh `feat/next` branch, with a stale cache still listing those files.
 * `.paqad/` is git-ignored, as in an onboarded project, so the cache itself is not
 * a working-tree change.
 */
export function makeRepoWithStaleCache(delivered: string[] = DELIVERED_FILES): string {
  const root = makeEmptyRepo('main');
  for (const file of delivered) writeRepoFile(root, file, 'export const delivered = 1;\n');
  commitAll(root, 'the earlier change, already merged');
  git(root, ['switch', '-q', '-c', 'feat/next']);
  writeChangedFilesCache(root, delivered);
  return root;
}

/**
 * Turn an existing temp project into a git repo whose changed files are exactly `files`
 * (issue #646: changed files come from git only, so tests drive them through git instead
 * of writing the retired cache). Everything else already on disk is committed on `main`
 * as base history; each listed file stays out of that commit, so git reports it as
 * untracked (a missing one is created first, existing content is left alone). `.paqad/`
 * is excluded via `.git/info/exclude` unless a listed path lives under it, so framework
 * output written later does not leak into the change.
 */
export function seedGitChangedFiles(root: string, files: string[]): void {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@paqad.dev']);
  git(root, ['config', 'user.name', 'paqad test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  if (!files.some((file) => file.startsWith('.paqad/'))) {
    writeRepoFile(root, '.git/info/exclude', '.paqad/\n');
  }
  for (const file of files) {
    if (!existsSync(join(root, file))) writeRepoFile(root, file, `// changed for test: ${file}\n`);
  }
  git(root, ['add', '-A']);
  if (files.length > 0) git(root, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...files]);
  git(root, ['commit', '-qm', 'base', '--allow-empty']);
}
