import { execFileSync } from 'node:child_process';

export function isGitTracked(projectRoot: string, path: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function isGitIgnored(projectRoot: string, path: string): boolean {
  if (isGitTracked(projectRoot, path)) {
    return false;
  }
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', '--', path], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function gitPendingPaths(projectRoot: string, paths: readonly string[]): string[] | null {
  if (paths.length === 0) return [];
  let out: string;
  try {
    out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...paths], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  return out
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/^"|"$/g, ''))
    .sort();
}
