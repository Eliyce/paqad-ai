import { execFileSync } from 'node:child_process';

import { changedFilesSince, type ChangeStartPoint } from '@/feature-evidence/delivery.js';
import { isPaqadArtifactPath } from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

export const GIT_READ_TIMEOUT_MS = 2_000;
export const COMMIT_TIMES_LIMIT = 200;
const GIT_READ_MAX_BYTES = 16 * 1024 * 1024;

export interface ChangeGitReading {
  files: string[];
  commitTimes: Map<string, string>;
}

function gitRead(projectRoot: string, args: string[]): string[] {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_READ_TIMEOUT_MS,
    maxBuffer: GIT_READ_MAX_BYTES,
  })
    .split('\0')
    .filter((entry) => entry.length > 0);
}

export function readChangeGit(
  projectRoot: string,
  baseBranch: string | null,
  onError: (error: unknown) => void,
  start?: ChangeStartPoint | null,
): ChangeGitReading | null {
  const base =
    start === undefined
      ? readGitState(projectRoot, baseBranch ? { baseBranch } : {}).base_commit
      : (start?.commit ?? undefined);
  if (!base) return null;
  try {
    const files = new Set<string>();
    if (start) {
      const since = changedFilesSince(projectRoot, start);
      if (since === null) throw new Error('git could not list the changed files');
      for (const path of since) files.add(path);
    } else {
      for (const path of [
        ...gitRead(projectRoot, ['diff', '--name-only', '--relative', '-z', base]),
        ...gitRead(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
      ]) {
        if (!isPaqadArtifactPath(path)) files.add(path);
      }
    }
    const commitTimes = new Map<string, string>();
    for (const entry of gitRead(projectRoot, [
      'log',
      '-z',
      `--max-count=${COMMIT_TIMES_LIMIT}`,
      '--format=%H %cI',
      `${base}..HEAD`,
    ])) {
      const [sha, at] = entry.trim().split(' ');
      if (sha && at) commitTimes.set(sha, at);
    }
    return { files: [...files].sort(), commitTimes };
  } catch (error) {
    onError(error);
    return null;
  }
}

export function readWorkingTreeDirty(projectRoot: string): boolean | null {
  try {
    const paths = [
      ...gitRead(projectRoot, ['diff', '--name-only', '--relative', '-z', 'HEAD']),
      ...gitRead(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
    ];
    return paths.some((path) => !isPaqadArtifactPath(path));
  } catch {
    return null;
  }
}
