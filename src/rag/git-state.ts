/**
 * Branch / git-state reader for the RAG index (RAG buildout F7).
 *
 * The index must know which branch and commit it reflects, and the base it
 * diverged from, so a branch switch can self-heal (F9) and base-drift can be
 * surfaced (F27). This is a small, synchronous `execFileSync` wrapper around four
 * read-only git queries. Every field is best-effort: a non-git directory, a
 * detached HEAD, or an unborn branch degrades each field to `undefined` rather
 * than throwing, so the index build never fails because of git.
 */
import { execFileSync } from 'node:child_process';

export interface GitState {
  /** Current branch short name (`undefined` on detached HEAD / non-git). */
  branch?: string;
  /** Current HEAD commit sha. */
  head_commit?: string;
  /** The base branch this branch is compared against (auto-detected or configured). */
  base_branch?: string;
  /** The merge-base commit of HEAD and the base branch. */
  base_commit?: string;
}

export interface GitStateOptions {
  /**
   * Base branch to diff against. When omitted, auto-detect: the first of `main`
   * then `master` that exists. (RAG buildout F10 threads the `rag_base_branch`
   * config value in here.)
   */
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

/** True when `ref` resolves to a commit in this repo. */
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

/**
 * Read the branch/commit/base state of `projectRoot`. Returns an all-`undefined`
 * object for a non-git directory; individual fields fall to `undefined` when
 * their query cannot resolve (detached HEAD, unborn branch, missing base).
 */
export function readGitState(projectRoot: string, options: GitStateOptions = {}): GitState {
  // `--is-inside-work-tree` is the cheap gate: a non-git dir returns nothing and
  // we skip the rest, leaving every field undefined (graceful degrade).
  if (git(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return {};
  }

  const branchRaw = git(projectRoot, ['symbolic-ref', '--short', '--quiet', 'HEAD']);
  const branch = branchRaw && branchRaw.length > 0 ? branchRaw : undefined; // undefined on detached HEAD
  const head_commit = git(projectRoot, ['rev-parse', 'HEAD']);

  const base_branch = detectBaseBranch(projectRoot, options.baseBranch);
  const base_commit = base_branch
    ? git(projectRoot, ['merge-base', 'HEAD', base_branch])
    : undefined;

  return { branch, head_commit, base_branch, base_commit };
}
