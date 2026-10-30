import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export const TREE_IDENTITY_EXCLUDED_DIRS: readonly string[] = [
  PATHS.EVIDENCE_LEDGER_DIR,
  PATHS.CHECKS_DIR,
  PATHS.TRACEABILITY_DIR,
  PATHS.DECISIONS_DIR,
];

export const TREE_IDENTITY_TIMEOUT_MS = 60_000;

export interface TreeIdentity {
  digest: string;
  head_commit: string | null;
  computed_at: string;
}

export type TreeIdentityResult =
  { identity: TreeIdentity; reason: null } | { identity: null; reason: string };

export interface TreeIdentityOptions {
  now?: () => string;
  timeoutMs?: number;
  nowMs?: () => number;
  gitBinary?: string;
  tempRoot?: string;
}

class TreeIdentityError extends Error {}

class GitCommandError extends Error {}

export function computeTreeIdentity(
  projectRoot: string,
  options: TreeIdentityOptions = {},
): TreeIdentity | null {
  return computeTreeIdentityResult(projectRoot, options).identity;
}

export function computeTreeIdentityResult(
  projectRoot: string,
  options: TreeIdentityOptions = {},
): TreeIdentityResult {
  const now = options.now ?? (() => new Date().toISOString());
  const nowMs = options.nowMs ?? (() => Date.now());
  const deadline = nowMs() + (options.timeoutMs ?? TREE_IDENTITY_TIMEOUT_MS);
  const git = (args: string[], env?: NodeJS.ProcessEnv): string =>
    runGit(options.gitBinary ?? 'git', args, projectRoot, deadline - nowMs(), env);

  let workDir: string | null = null;
  try {
    const head = resolveHead(git);
    const realIndex = resolve(projectRoot, git(['rev-parse', '--git-path', 'index']).trim());
    if (!existsSync(realIndex)) return { identity: null, reason: 'the git index does not exist' };
    workDir = mkdtempSync(join(options.tempRoot ?? tmpdir(), 'paqad-tree-'));
    const tempIndex = join(workDir, 'index');
    copyFileSync(realIndex, tempIndex);
    keepIndexTimestamp(realIndex, tempIndex);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    git(['add', '-A'], env);
    git(
      ['rm', '-r', '--cached', '--ignore-unmatch', '--quiet', '--', ...TREE_IDENTITY_EXCLUDED_DIRS],
      env,
    );
    const digest = git(['write-tree'], env).trim();
    return { identity: { digest, head_commit: head, computed_at: now() }, reason: null };
  } catch (error) {
    return { identity: null, reason: (error as Error).message };
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

function keepIndexTimestamp(realIndex: string, tempIndex: string): void {
  const stamp = (Math.floor(statSync(realIndex).mtimeMs) - 1) / 1000;
  utimesSync(tempIndex, stamp, stamp);
}

function resolveHead(git: (args: string[]) => string): string | null {
  try {
    git(['rev-parse', '--git-dir']);
  } catch (error) {
    if (error instanceof GitCommandError) throw new TreeIdentityError('not a git repository');
    throw error;
  }
  try {
    return git(['rev-parse', '--verify', '--quiet', 'HEAD']).trim();
  } catch (error) {
    if (error instanceof TreeIdentityError) throw error;
    if (git(['rev-list', '-n', '1', '--all']).trim().length === 0) {
      throw new TreeIdentityError('the repository has no commits');
    }
    return null;
  }
}

function runGit(
  binary: string,
  args: string[],
  cwd: string,
  remainingMs: number,
  env?: NodeJS.ProcessEnv,
): string {
  if (remainingMs <= 0) throw new TreeIdentityError('the tree identity ran past its time limit');
  try {
    return execFileSync(binary, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: remainingMs,
      maxBuffer: 16 * 1024 * 1024,
      ...(env ? { env } : {}),
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; signal?: string | null };
    if (failure.code === 'ENOENT') throw new TreeIdentityError('git is not installed');
    if (failure.code === 'ETIMEDOUT' || failure.signal === 'SIGTERM') {
      throw new TreeIdentityError('the tree identity ran past its time limit');
    }
    const detail = String(failure.stderr ?? '')
      .split('\n')[0]
      ?.trim();
    throw new GitCommandError(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
}
