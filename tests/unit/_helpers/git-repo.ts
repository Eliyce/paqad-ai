import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_INDEX_FILE: undefined },
  });
}

export function writeRepoFile(root: string, relativePath: string, content: string): void {
  mkdirSync(dirname(join(root, relativePath)), { recursive: true });
  writeFileSync(join(root, relativePath), content);
}

export function initGitRepo(root: string, files: Record<string, string> = {}): void {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  for (const [path, content] of Object.entries(files)) writeRepoFile(root, path, content);
}

export function commitAll(root: string, message = 'commit'): void {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', message]);
}
