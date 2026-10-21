import { execFileSync } from 'node:child_process';
import { opendirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

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

export interface HeadRef {
  repo: boolean;
  branch: string | null;
  detached: boolean;
}

function opensAsDirectory(path: string): boolean {
  try {
    opendirSync(path).closeSync();
    return true;
  } catch {
    return false;
  }
}

function findGitDir(projectRoot: string): string | null {
  let dir = resolve(projectRoot);
  for (;;) {
    const candidate = join(dir, '.git');
    let contents: string;
    try {
      contents = readFileSync(candidate, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EISDIR') return candidate;
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && opensAsDirectory(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
      continue;
    }
    const pointer = /^gitdir:\s*(.+)$/m.exec(contents);
    if (!pointer) return null;
    const target = pointer[1]!.trim();
    return isAbsolute(target) ? target : resolve(dir, target);
  }
}

export function readHeadRef(projectRoot: string): HeadRef {
  const gitDir = findGitDir(projectRoot);
  if (gitDir === null) return { repo: false, branch: null, detached: false };
  let head: string;
  try {
    head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return { repo: false, branch: null, detached: false };
  }
  const symbolic = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (symbolic) return { repo: true, branch: symbolic[1]!, detached: false };
  return { repo: true, branch: null, detached: true };
}
