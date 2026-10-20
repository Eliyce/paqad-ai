import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';
import { shouldDebounce, touchMarker } from '@/background/debounce-marker.js';
import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';

import { readGitState } from './git-state.js';

export interface BaseDriftSnapshot {
  base_branch: string;
  remote_ref: string;
  ahead: number;
  checked_at: string;
}

export const DEFAULT_BASE_DRIFT_INTERVAL_MS = 10 * 60 * 1000;

const STALE_LOCK_MS = 10 * 60 * 1000;

export type GitRunner = (args: string[]) => string | undefined;

function defaultGit(projectRoot: string): GitRunner {
  return (args: string[]) => {
    try {
      return execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  };
}

export interface BaseDriftOptions {
  baseBranch?: string;
  remote?: string;
  git?: GitRunner;
}

export function computeBaseDrift(
  projectRoot: string,
  options: BaseDriftOptions = {},
): BaseDriftSnapshot | null {
  const git = options.git ?? defaultGit(projectRoot);
  const remote = options.remote ?? 'origin';
  const state = readGitState(projectRoot, { baseBranch: options.baseBranch });
  if (!state.base_branch || !state.base_commit) {
    return null;
  }
  const remoteRef = `${remote}/${state.base_branch}`;
  if (git(['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]) === undefined) {
    return null;
  }
  const aheadRaw = git(['rev-list', '--count', `${state.base_commit}..${remoteRef}`]);
  const ahead = aheadRaw !== undefined && /^\d+$/.test(aheadRaw) ? Number(aheadRaw) : 0;
  return {
    base_branch: state.base_branch,
    remote_ref: remoteRef,
    ahead,
    checked_at: new Date().toISOString(),
  };
}

export interface RefreshBaseDriftOptions extends BaseDriftOptions {
  now?: () => number;
  minIntervalMs?: number;
}

export type RefreshBaseDriftResult =
  | { refreshed: true }
  | { refreshed: false; reason: 'debounced' | 'in-flight' | 'no-base' | 'error' };

export async function refreshBaseDrift(
  projectRoot: string,
  options: RefreshBaseDriftOptions = {},
): Promise<RefreshBaseDriftResult> {
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_BASE_DRIFT_INTERVAL_MS;
  const markerPath = join(projectRoot, PATHS.BASE_DRIFT_MARKER);
  if (shouldDebounce(markerPath, minIntervalMs, now)) {
    return { refreshed: false, reason: 'debounced' };
  }
  const lockDir = join(projectRoot, PATHS.BASE_DRIFT_LOCK);
  const lock = tryAcquireLock(lockDir, { staleLockMs: STALE_LOCK_MS });
  if (!lock.acquired) {
    return { refreshed: false, reason: 'in-flight' };
  }
  touchMarker(markerPath, now);
  try {
    const git = options.git ?? defaultGit(projectRoot);
    const remote = options.remote ?? 'origin';
    const state = readGitState(projectRoot, { baseBranch: options.baseBranch });
    if (!state.base_branch) {
      return { refreshed: false, reason: 'no-base' };
    }
    const base = state.base_branch;
    const remoteRef = `${remote}/${base}`;

    const lsRemote = git(['ls-remote', remote, base]);
    const remoteTip = lsRemote ? lsRemote.split(/\s+/)[0] : undefined;
    const localRemoteTip = git(['rev-parse', '--verify', '--quiet', remoteRef]);
    if (remoteTip && remoteTip !== localRemoteTip) {
      git(['fetch', '--quiet', remote, base]);
    }

    const snapshot = computeBaseDrift(projectRoot, options);
    if (snapshot) {
      await atomicWriteFile(
        join(projectRoot, PATHS.BASE_DRIFT_STATE),
        `${JSON.stringify(snapshot, null, 2)}\n`,
      );
    }
    return { refreshed: true };
  } catch {
    return { refreshed: false, reason: 'error' };
  } finally {
    releaseLock(lockDir);
  }
}

export function loadBaseDrift(projectRoot: string): BaseDriftSnapshot | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, PATHS.BASE_DRIFT_STATE), 'utf8'),
    ) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as BaseDriftSnapshot).base_branch === 'string' &&
      typeof (parsed as BaseDriftSnapshot).ahead === 'number'
    ) {
      return parsed as BaseDriftSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

export function composeBaseDriftSection(snapshot: BaseDriftSnapshot | null): string {
  if (!snapshot || snapshot.ahead <= 0) {
    return '';
  }
  const commits = snapshot.ahead === 1 ? '1 commit' : `${snapshot.ahead} commits`;
  return (
    `## Base drift\n` +
    `> Heads up: \`${snapshot.remote_ref}\` is ${commits} ahead of where this branch started. ` +
    `Pull or rebase before relying on the base being current.\n`
  );
}
