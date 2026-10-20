import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execaSync } from 'execa';

export const DELIVERED_FILES = ['src/delivered-a.ts', 'src/delivered-b.ts'];

export const STALE_CACHE_PATH = '.paqad/session/changed-files.json';

export function git(root: string, args: string[]): void {
  execaSync('git', args, { cwd: root });
}

export function writeRepoFile(root: string, relPath: string, content: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

export function writeChangedFilesCache(root: string, files: unknown): void {
  writeRepoFile(root, STALE_CACHE_PATH, JSON.stringify(files));
}

export function commitAll(root: string, message: string): void {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}

export function makeEmptyRepo(branch = 'main'): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-646-'));
  git(root, ['init', '-q', '-b', branch]);
  git(root, ['config', 'user.email', 'test@paqad.dev']);
  git(root, ['config', 'user.name', 'paqad test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeRepoFile(root, '.gitignore', '.paqad/\n');
  return root;
}

export function makeRepoWithStaleCache(delivered: string[] = DELIVERED_FILES): string {
  const root = makeEmptyRepo('main');
  for (const file of delivered) writeRepoFile(root, file, 'export const delivered = 1;\n');
  commitAll(root, 'the earlier change, already merged');
  git(root, ['switch', '-q', '-c', 'feat/next']);
  writeChangedFilesCache(root, delivered);
  return root;
}

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
