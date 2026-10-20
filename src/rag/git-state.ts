import { execFileSync } from 'node:child_process';

export interface GitState {
  branch?: string;
  head_commit?: string;
  base_branch?: string;
  base_commit?: string;
}

export interface GitStateOptions {
  baseBranch?: string;
}

function git(projectRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function refExists(projectRoot: string, ref: string): boolean {
  return git(projectRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== undefined;
}

function detectBaseBranch(projectRoot: string, explicit?: string): string | undefined {
  if (explicit && refExists(projectRoot, explicit)) return explicit;
  for (const candidate of ['main', 'master']) {
    if (refExists(projectRoot, candidate)) return candidate;
  }
  return undefined;
}

export function readGitState(projectRoot: string, options: GitStateOptions = {}): GitState {
  if (git(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return {};
  }

  const branchRaw = git(projectRoot, ['symbolic-ref', '--short', '--quiet', 'HEAD']);
  const branch = branchRaw && branchRaw.length > 0 ? branchRaw : undefined;
  const head_commit = git(projectRoot, ['rev-parse', 'HEAD']);

  const base_branch = detectBaseBranch(projectRoot, options.baseBranch);
  const base_commit = base_branch
    ? git(projectRoot, ['merge-base', 'HEAD', base_branch])
    : undefined;

  return { branch, head_commit, base_branch, base_commit };
}
