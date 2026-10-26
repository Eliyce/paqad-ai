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

function reflogSubjects(projectRoot: string, ref: string): string[] {
  return (git(projectRoot, ['reflog', 'show', '--format=%gs', ref]) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The branch the given branch was cut from, read from the reflog: `branch: Created from <ref>`
 * names it, and `Created from HEAD` is resolved through the HEAD reflog's
 * `checkout: moving from <ref> to <branch>`. Null when the reflog is gone (fresh clone, gc,
 * worktree) or names nothing that still resolves.
 */
export function forkBranchOf(
  projectRoot: string,
  branch: string | null | undefined,
): string | null {
  if (!branch) return null;
  const created = reflogSubjects(projectRoot, `refs/heads/${branch}`).at(-1) ?? '';
  let from = /^branch: Created from (.+)$/.exec(created)?.[1]?.trim() ?? '';
  if (from === 'HEAD') {
    const moved = reflogSubjects(projectRoot, 'HEAD')
      .map((subject) => /^checkout: moving from (.+) to (.+)$/.exec(subject))
      .filter((match): match is RegExpExecArray => match !== null && match[2] === branch)
      .at(-1);
    from = moved?.[1]?.trim() ?? '';
  }
  from = from.replace(/^refs\/heads\//, '');
  if (from === '' || from === branch || from === 'HEAD') return null;
  return refExists(projectRoot, from) ? from : null;
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
