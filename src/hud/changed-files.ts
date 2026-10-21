import { execFileSync } from 'node:child_process';

import { isPaqadArtifactPath } from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

export const GIT_READ_TIMEOUT_MS = 2_000;
const GIT_READ_MAX_BYTES = 16 * 1024 * 1024;

function gitPaths(projectRoot: string, args: string[]): string[] {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_READ_TIMEOUT_MS,
    maxBuffer: GIT_READ_MAX_BYTES,
  })
    .split('\0')
    .filter((path) => path.length > 0);
}

export function readChangedFiles(
  projectRoot: string,
  baseBranch: string | null,
  onError: (error: unknown) => void,
): string[] | null {
  const base = readGitState(projectRoot, baseBranch ? { baseBranch } : {}).base_commit;
  if (!base) return null;
  try {
    const files = new Set<string>();
    for (const path of [
      ...gitPaths(projectRoot, ['diff', '--name-only', '--relative', '-z', base]),
      ...gitPaths(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]) {
      if (!isPaqadArtifactPath(path)) files.add(path);
    }
    return [...files].sort();
  } catch (error) {
    onError(error);
    return null;
  }
}
