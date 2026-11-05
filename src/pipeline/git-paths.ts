import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ChangeStartLike {
  commit: string;
  worktree: Record<string, string> | null;
  mergedBase?: string | null;
}

export const DELETED_AT_START = 'deleted';

export function gitPathList(projectRoot: string, args: string[]): string[] | null {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\0')
      .filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

export function digestWorkingFile(projectRoot: string, relativePath: string): string | null {
  try {
    return createHash('sha256')
      .update(readFileSync(join(projectRoot, relativePath)))
      .digest('hex');
  } catch {
    return null;
  }
}

export function changedFilesSince(projectRoot: string, start: ChangeStartLike): string[] | null {
  const diff = gitPathList(projectRoot, ['diff', '--name-only', '--relative', '-z', start.commit]);
  const untracked = gitPathList(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (diff === null || untracked === null) return null;
  const merged = start.mergedBase
    ? gitPathList(projectRoot, ['diff', '--name-only', '--relative', '-z', start.mergedBase])
    : null;
  if (start.mergedBase && merged === null) return null;
  const differsFromBase = merged ? new Set(merged) : null;
  const worktree = start.worktree ?? {};
  return [
    ...new Set([
      ...diff.filter((path) => !differsFromBase || differsFromBase.has(path)),
      ...untracked,
    ]),
  ]
    .map((path) => path.replace(/\\/g, '/'))
    .filter((path) => !isPaqadArtifactPath(path))
    .filter((path) => {
      const atStart = worktree[path];
      return (
        atStart === undefined ||
        (digestWorkingFile(projectRoot, path) ?? DELETED_AT_START) !== atStart
      );
    })
    .sort();
}

function parseAddedLines(diff: string): Record<string, string> {
  const added: Record<string, string[]> = {};
  let path: string | null = null;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/\t$/u, '');
      path = name.startsWith('b/') ? name.slice(2) : null;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && path !== null && line.startsWith('+')) {
      (added[path] ??= []).push(line.slice(1));
    }
  }
  return Object.fromEntries(Object.entries(added).map(([file, lines]) => [file, lines.join('\n')]));
}

export function addedLinesSince(
  projectRoot: string,
  start: ChangeStartLike,
): Record<string, string> | null {
  const changed = changedFilesSince(projectRoot, start);
  const untracked = gitPathList(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (changed === null || untracked === null) return null;
  let diff: string;
  try {
    diff = execFileSync(
      'git',
      [
        '-c',
        'core.quotepath=off',
        'diff',
        '-U0',
        '--no-color',
        '--no-ext-diff',
        '--relative',
      ].concat(start.commit),
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30_000,
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  } catch {
    return null;
  }
  const inChange = new Set(changed);
  const added = Object.fromEntries(
    Object.entries(parseAddedLines(diff)).filter(([path]) => inChange.has(path)),
  );
  for (const path of untracked) {
    const normalized = path.replace(/\\/g, '/');
    if (!inChange.has(normalized)) continue;
    try {
      added[normalized] = readFileSync(join(projectRoot, normalized), 'utf8');
    } catch {}
  }
  return added;
}

export function isPaqadArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized === '.paqad' || normalized.startsWith('.paqad/') || normalized.includes('/.paqad/')
  );
}
