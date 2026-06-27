/**
 * Proactive base-drift awareness (RAG buildout F27).
 *
 * Warns "origin/main moved N commits ahead since you branched" BEFORE the developer pulls,
 * as a separate secondary context layer. The cost model is strict:
 *   - Off the critical path: the network step (a debounced `git fetch`) runs only in the
 *     detached background worker; the prompt path merely reads the persisted snapshot.
 *   - No per-prompt network: a debounce marker floors the fetch to one per interval
 *     (5-15 min), and an `ls-remote` tip-check skips the fetch entirely when the remote
 *     base has not moved.
 *   - Fail-silent: any git/network/auth failure degrades to "no drift surfaced", never an
 *     error and never a block.
 *
 * Drift itself is computed from LOCAL refs (`rev-list --count <merge-base>..origin/<base>`),
 * so once a fetch has happened the read is network-free. Reuses F7's base detection and the
 * F1 debounce-marker + single-flight-lock.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';
import { shouldDebounce, touchMarker } from '@/background/debounce-marker.js';
import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';

import { readGitState } from './git-state.js';

/** A persisted base-drift reading (the secondary context layer's state). */
export interface BaseDriftSnapshot {
  /** The base branch compared against (e.g. `main`). */
  base_branch: string;
  /** The remote-tracking ref checked (e.g. `origin/main`). */
  remote_ref: string;
  /** Commits `origin/<base>` is ahead of where this branch diverged. 0 ⇒ no drift. */
  ahead: number;
  /** ISO timestamp of the reading. */
  checked_at: string;
}

/** Default floor between background fetches (within the 5-15 min band the spec allows). */
export const DEFAULT_BASE_DRIFT_INTERVAL_MS = 10 * 60 * 1000;

/** A lock older than this (10 min) is treated as a crashed worker and reclaimed. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/** Injectable git runner (defaults to a read-only `execFileSync` wrapper). */
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
  /** Base branch override (F10's `rag_base_branch`); auto-detected when omitted. */
  baseBranch?: string;
  /** Remote name. Defaults to `origin`. */
  remote?: string;
  /** Injectable git runner (tests). */
  git?: GitRunner;
}

/**
 * Compute base drift from LOCAL refs (no network). Returns null when there is no base, no
 * fetched remote-tracking ref, or git is unavailable. `ahead` is the number of commits the
 * remote base has advanced past this branch's merge-base.
 */
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
  // The remote-tracking ref must exist locally (a fetch happened at some point).
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
  /** Clock (tests). */
  now?: () => number;
  /** Minimum interval between real fetches. Defaults to {@link DEFAULT_BASE_DRIFT_INTERVAL_MS}. */
  minIntervalMs?: number;
}

export type RefreshBaseDriftResult =
  | { refreshed: true }
  | { refreshed: false; reason: 'debounced' | 'in-flight' | 'no-base' | 'error' };

/**
 * The background step: debounced + single-flight, `ls-remote` tip-check, conditional
 * `git fetch`, then compute + persist the snapshot. Never throws; any failure returns a
 * reason. Meant to run in the detached worker, never on the prompt path.
 */
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
  // Open the debounce window up front, so a crash mid-fetch still floors the next attempt.
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

    // ls-remote tip-check: only fetch when the remote base actually moved. A failure
    // (offline, auth) leaves remoteTip undefined and we skip the fetch, fail-silent.
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

/** Read the persisted drift snapshot (no network). Best-effort; null on missing/corrupt. */
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

/**
 * Compose the base-drift secondary context layer. Returns `''` when there is no drift
 * (no snapshot, or `ahead === 0`), so it adds nothing in the common case. A one-line
 * heads-up otherwise — advisory, never blocking.
 */
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
