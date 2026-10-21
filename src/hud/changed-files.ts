import { execFileSync } from 'node:child_process';

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
): ChangeGitReading | null {
  const base = readGitState(projectRoot, baseBranch ? { baseBranch } : {}).base_commit;
  if (!base) return null;
  try {
    const files = new Set<string>();
    for (const path of [
      ...gitRead(projectRoot, ['diff', '--name-only', '--relative', '-z', base]),
      ...gitRead(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]) {
      if (!isPaqadArtifactPath(path)) files.add(path);
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
