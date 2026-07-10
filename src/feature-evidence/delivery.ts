// Per-feature delivery/git linkage (issue #339, Phase 5): `delivery.json`.
//
// A feature's bundle records the branch + the complete commit trail + the merge that
// shipped it, so an exported record can prove WHICH code it attests. Commits are
// appended as they land (a native `post-commit` hook) and reconciled from local git on
// any session (the backfill path, for a clone/CI without the hook). All git reads are
// best-effort and read-only — a non-git dir or detached HEAD degrades to a partial
// record rather than throwing.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readGitState } from '@/rag/git-state.js';

import { featureFilePath, isFeatureDirName, parseFeatureDirName } from './paths.js';
import { currentFeature } from './stage-ledger.js';

/** Doc type stamped on a `delivery.json` record. */
export const DELIVERY_DOC_TYPE = 'paqad.delivery';
export const DELIVERY_SCHEMA_VERSION = 1;

/** One commit in a feature's trail. */
export interface DeliveryCommit {
  sha: string;
  subject: string;
}

/** The `delivery.json` record — a feature's branch, commit trail, and merge. */
export interface DeliveryRecord {
  schema_version: number;
  doc_type: typeof DELIVERY_DOC_TYPE;
  branch: string | null;
  base_branch: string | null;
  commits: DeliveryCommit[];
  head_sha: string | null;
  merge_commit: string | null;
  captured_at: string | null;
}

function emptyDelivery(): DeliveryRecord {
  return {
    schema_version: DELIVERY_SCHEMA_VERSION,
    doc_type: DELIVERY_DOC_TYPE,
    branch: null,
    base_branch: null,
    commits: [],
    head_sha: null,
    merge_commit: null,
    captured_at: null,
  };
}

function isDelivery(value: unknown): value is DeliveryRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return r.doc_type === DELIVERY_DOC_TYPE && Array.isArray(r.commits);
}

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

/** Tolerant read of a feature's `delivery.json`, or a fresh empty record when absent. */
export function readFeatureDelivery(projectRoot: string, dirName: string): DeliveryRecord {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'delivery')), 'utf8'),
    ) as unknown;
    if (isDelivery(parsed)) return parsed;
  } catch {
    // Absent / unreadable / malformed — fall through to a fresh record.
  }
  return emptyDelivery();
}

/** Write a feature's `delivery.json` (atomic). */
export function writeFeatureDelivery(
  projectRoot: string,
  dirName: string,
  record: DeliveryRecord,
): void {
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'delivery')), record);
}

/**
 * Append one commit to a feature's trail, deduped by sha (the complete trail, not just
 * the last commit). Returns the updated record. `capturedAt` stamps when the record was
 * last touched (supplied so the call stays deterministic in tests).
 */
export function appendCommitToFeature(
  projectRoot: string,
  dirName: string,
  commit: DeliveryCommit,
  capturedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  if (!record.commits.some((c) => c.sha === commit.sha)) {
    record.commits.push(commit);
  }
  record.head_sha = commit.sha;
  record.captured_at = capturedAt;
  writeFeatureDelivery(projectRoot, dirName, record);
  return record;
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

/**
 * The commits on `branch` since it diverged from `base` (newest first), read from local
 * git. Uses a NUL field separator so a commit subject with any character round-trips.
 * Returns `[]` on any git failure.
 */
export function commitsSinceBase(
  projectRoot: string,
  baseRef: string | undefined,
  headRef = 'HEAD',
): DeliveryCommit[] {
  const range = baseRef ? `${baseRef}..${headRef}` : headRef;
  const out = git(projectRoot, ['log', range, '--format=%H%x1f%s']);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split('\x1f');
      return { sha, subject: rest.join('\x1f') };
    });
}

/**
 * Reconcile a feature's `delivery.json` from local git — the backfill/reconcile path
 * that runs on any session so a clone/CI without the `post-commit` hook still gets
 * accurate linkage. Reads the branch/base/head and the full commit trail (base..HEAD),
 * unions the commits with any already recorded (hook-appended), and stamps
 * `captured_at`. Best-effort: a non-git dir yields a record with null git fields.
 */
export function reconcileDeliveryFromGit(
  projectRoot: string,
  dirName: string,
  capturedAt: string,
  options: { baseBranch?: string } = {},
): DeliveryRecord {
  const state = readGitState(projectRoot, { baseBranch: options.baseBranch });
  const record = readFeatureDelivery(projectRoot, dirName);
  const seen = new Set(record.commits.map((c) => c.sha));
  for (const commit of commitsSinceBase(projectRoot, state.base_branch)) {
    if (!seen.has(commit.sha)) {
      record.commits.push(commit);
      seen.add(commit.sha);
    }
  }
  record.branch = state.branch ?? record.branch;
  record.base_branch = state.base_branch ?? record.base_branch;
  record.head_sha = state.head_commit ?? record.head_sha;
  record.captured_at = capturedAt;
  writeFeatureDelivery(projectRoot, dirName, record);
  return record;
}

/** Stamp `merge_commit` on a feature's delivery record (the `post-merge` hook path). */
export function stampMergeCommit(
  projectRoot: string,
  dirName: string,
  mergeSha: string,
  capturedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.merge_commit = mergeSha;
  record.captured_at = capturedAt;
  writeFeatureDelivery(projectRoot, dirName, record);
  return record;
}

/** The trailing ULID of a feature dir name (time-sortable), or the name itself if it
 *  does not parse (defensive — every listed dir is a validated feature name). */
function ulidOf(dirName: string): string {
  return parseFeatureDirName(dirName)?.ulid ?? dirName;
}

/** Every feature dir name under the evidence container (excludes `_session`/junk). */
export function listFeatureDirs(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, PATHS.FEATURE_EVIDENCE_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isFeatureDirName(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve which feature a commit on `branch` belongs to (the `post-commit` hook's
 * branch resolution). A feature matches when its `delivery.json` records that branch.
 * Documented tie-break for a shared branch: the active-feature pointer wins, else the
 * most-recent matching feature (dir names sort by their trailing ULID, which is
 * time-ordered), else null.
 */
export function resolveDeliveryFeatureByBranch(
  projectRoot: string,
  branch: string,
  activeDirName?: string | null,
): string | null {
  const matches = listFeatureDirs(projectRoot).filter(
    (dirName) => readFeatureDelivery(projectRoot, dirName).branch === branch,
  );
  if (matches.length === 0) return null;
  if (activeDirName && matches.includes(activeDirName)) return activeDirName;
  // Most-recent: order by the trailing ULID (time-sortable), NOT the full dir name —
  // the slug prefix would otherwise dominate the ordering. The max ULID is newest.
  return [...matches].sort((x, y) => ulidOf(x).localeCompare(ulidOf(y))).at(-1) ?? null;
}

/**
 * Record a landed commit against the feature it belongs to, resolved by the current
 * branch (the `post-commit` hook's core). Prefers the branch-matched feature; falls back
 * to the active feature so the very first commit on a new branch (before delivery.json
 * records the branch) still attaches. Returns the dir it recorded against, or null when
 * no feature can be resolved.
 */
export function recordCommitForBranch(
  projectRoot: string,
  sessionId: string,
  commit: DeliveryCommit,
  capturedAt: string,
): string | null {
  const branch = git(projectRoot, ['branch', '--show-current']);
  const active = currentFeature(projectRoot, sessionId);
  const dirName =
    (branch ? resolveDeliveryFeatureByBranch(projectRoot, branch, active) : null) ?? active;
  if (!dirName) return null;
  const record = readFeatureDelivery(projectRoot, dirName);
  if (record.branch === null && branch) {
    record.branch = branch;
  }
  if (!record.commits.some((c) => c.sha === commit.sha)) {
    record.commits.push(commit);
  }
  record.head_sha = commit.sha;
  record.captured_at = capturedAt;
  writeFeatureDelivery(projectRoot, dirName, record);
  return dirName;
}
