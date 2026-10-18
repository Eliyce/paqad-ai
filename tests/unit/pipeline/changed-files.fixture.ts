import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execaSync } from 'execa';

import { PATHS } from '@/core/constants/paths.js';

// Issue #544 fixtures: a real git repo on a feature branch off `main`, so the
// changed-files reconcile engages exactly as it does in a developer's checkout.

/** The files an earlier, already-merged change left in the session cache. */
export const DELIVERED_FILES = ['src/delivered-a.ts', 'src/delivered-b.ts'];

function git(root: string, args: string[]): void {
  execaSync('git', args, { cwd: root });
}

export function writeRepoFile(root: string, relPath: string, content: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** Write `.paqad/session/changed-files.json` as the bare array every reader expects. */
export function writeChangedFilesCache(root: string, files: unknown): void {
  writeRepoFile(root, PATHS.CHANGED_FILES, JSON.stringify(files));
}

/**
 * A repo whose `main` already holds DELIVERED_FILES (committed and clean), checked
 * out on a fresh `feat/next` branch, with a stale cache still listing those files.
 * `.paqad/` is git-ignored, as in an onboarded project, so the cache itself is not
 * a working-tree change.
 */
export function makeRepoWithStaleCache(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-544-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@paqad.dev']);
  git(root, ['config', 'user.name', 'paqad test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeRepoFile(root, '.gitignore', '.paqad/\n');
  for (const file of DELIVERED_FILES) writeRepoFile(root, file, 'export const delivered = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'the earlier change, already merged']);
  git(root, ['switch', '-q', '-c', 'feat/next']);
  writeChangedFilesCache(root, DELIVERED_FILES);
  return root;
}
