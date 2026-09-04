// Per-feature delivery/git linkage (issue #339, Phase 5): `delivery.json`.
//
// A feature's bundle records the branch + the complete commit trail + the merge that
// shipped it, so an exported record can prove WHICH code it attests. Commits are
// appended as they land (a native `post-commit` hook) and reconciled from local git on
// any session (the backfill path, for a clone/CI without the hook). All git reads are
// best-effort and read-only — a non-git dir or detached HEAD degrades to a partial
// record rather than throwing.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readGitState } from '@/rag/git-state.js';

import { listFeatureDirs } from './enumerate.js';
import { readFeatureRecord } from './feature-record.js';
import { featureFilePath, parseFeatureDirName } from './paths.js';

// Re-exported from its leaf home (issue #404) so every existing `delivery.js` importer
// keeps working while `adoption.ts` can reach it without closing an import cycle.
export { listFeatureDirs };

/** Doc type stamped on a `delivery.json` record. */
export const DELIVERY_DOC_TYPE = 'paqad.delivery';
export const DELIVERY_SCHEMA_VERSION = 1;

/** One commit in a feature's trail. */
export interface DeliveryCommit {
  sha: string;
  subject: string;
}

/**
 * Whether/why a commit was made for this change (issue #511, AC-4). `user-requested` when
 * the developer asked to commit (mid-turn or at the end); `commit`/`decline` when the agent
 * asked and the developer answered; `ignored` when the agent asked and got no answer; `null`
 * when it was never asked. Recorded either way, so a change with no commit still shows WHY.
 */
export type CommitDecisionAnswer = 'commit' | 'decline' | 'ignored' | 'user-requested' | null;

/** The commit-decision block on a delivery record. */
export interface CommitDecision {
  asked: boolean;
  answer: CommitDecisionAnswer;
  recorded_at: string | null;
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
  /**
   * The commit decision (issue #511, AC-4). Optional so a pre-#511 delivery.json stays
   * valid (INV-3); {@link emptyDelivery} seeds the default so every new record carries it.
   */
  commit_decision?: CommitDecision;
  /**
   * The last time `delivery-link` could not link a commit and why (issue #511, RC-2.6) —
   * so a failed hook is visible in the bundle instead of only on discarded stdout. Optional.
   */
  last_link_attempt?: string | null;
}

/** The default commit-decision block: never asked. */
export function emptyCommitDecision(): CommitDecision {
  return { asked: false, answer: null, recorded_at: null };
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
    commit_decision: emptyCommitDecision(),
    last_link_attempt: null,
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
 * Seed a feature's `delivery.json` at open with the branch + base_branch (issue #511, RC-2).
 * This is what makes `resolveDeliveryFeatureByBranch` work for the FIRST commit — before
 * this, delivery.json was written only by the git hook, which resolved "no feature" because
 * nothing seeded the branch to match on. Idempotent: an existing record keeps its commits +
 * commit_decision and only back-fills a still-null branch/base. Best-effort by contract.
 */
export function seedFeatureDelivery(
  projectRoot: string,
  dirName: string,
  input: { branch: string | null; baseBranch: string | null; capturedAt: string },
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.branch = record.branch ?? input.branch;
  record.base_branch = record.base_branch ?? input.baseBranch;
  record.commit_decision = record.commit_decision ?? emptyCommitDecision();
  record.captured_at = input.capturedAt;
  writeFeatureDelivery(projectRoot, dirName, record);
  return record;
}

/** Record the commit decision (issue #511, AC-4) on a feature's delivery record. */
export function setCommitDecision(
  projectRoot: string,
  dirName: string,
  answer: CommitDecisionAnswer,
  recordedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.commit_decision = { asked: answer !== 'user-requested', answer, recorded_at: recordedAt };
  record.captured_at = recordedAt;
  writeFeatureDelivery(projectRoot, dirName, record);
  return record;
}

/** Stamp why `delivery-link` could not link a commit (issue #511, RC-2.6). */
export function recordLinkAttempt(
  projectRoot: string,
  dirName: string,
  reason: string,
  capturedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.last_link_attempt = `${capturedAt}: ${reason}`;
  writeFeatureDelivery(projectRoot, dirName, record);
  return record;
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
  // Issue #511 (RC-2.3) — a `post-commit` fires AFTER the bundle is closed (active is null),
  // so prefer the most-recent branch match that is NOT yet `done` (the change still landing)
  // over one already finished; only when every match is done do we fall back to the newest.
  // Most-recent orders by the trailing ULID (time-sortable), NOT the full dir name — the
  // slug prefix would otherwise dominate the ordering. The max ULID is newest.
  const newest = (dirs: string[]): string | null =>
    [...dirs].sort((x, y) => ulidOf(x).localeCompare(ulidOf(y))).at(-1) ?? null;
  const notDone = matches.filter(
    (dirName) => readFeatureRecord(projectRoot, dirName)?.status !== 'done',
  );
  return newest(notDone.length > 0 ? notDone : matches);
}

/**
 * Record a landed commit against the feature it belongs to, resolved by the current
 * branch (the `post-commit` hook's core). Prefers the branch-matched feature; falls back
 * to the passed active feature so the very first commit on a new branch (before delivery.json
 * records the branch) still attaches. Returns the dir it recorded against, or null when
 * no feature can be resolved.
 *
 * `active` is passed in (rather than resolved here) so this module never imports the
 * session/stage layer — keeping delivery a leaf of feature-evidence (issue #511).
 */
export function recordCommitForBranch(
  projectRoot: string,
  active: string | null,
  commit: DeliveryCommit,
  capturedAt: string,
): string | null {
  const branch = git(projectRoot, ['branch', '--show-current']);
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
