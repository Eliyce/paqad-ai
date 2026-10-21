import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { changeOwnTickets, computeCommitSplit, type CommitSplit } from '@/delivery/commit-split.js';
import { readGitState } from '@/rag/git-state.js';

import { stampFeatureDocument } from './bundle-document.js';
import type { EnvelopeHeader } from './envelope.js';
import { listFeatureDirs } from './enumerate.js';
import {
  isFeatureFinished,
  readChangeConstants,
  readFeatureRecord,
  updateFeatureRecord,
} from './feature-record.js';
import { featureChangeKey, featureFilePath } from './paths.js';

export { listFeatureDirs };

export const DELIVERY_DOC_TYPE = 'paqad.delivery';
export const DELIVERY_SCHEMA_VERSION = 2;

export interface DeliveryCommit {
  sha: string;
  subject: string;
}

export type CommitDecisionAnswer = 'commit' | 'decline' | 'ignored' | 'user-requested' | null;

export interface CommitDecision {
  asked: boolean;
  answer: CommitDecisionAnswer;
  recorded_at: string | null;
}

export type CiState = 'pass' | 'fail' | 'pending' | 'unknown';

export interface DeliveryPush {
  state: 'pushed' | 'failed';
  branch: string | null;
  sha: string | null;
  at: string;
}

export type DeliveryPrState = 'open' | 'merged' | 'closed';

export interface DeliveryPr {
  number: number | null;
  url: string | null;
  draft: boolean | null;
  state?: DeliveryPrState | null;
  head_sha?: string | null;
  at: string;
}

export interface DeliveryCiJob {
  name: string;
  status: string | null;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface DeliveryCi {
  sha: string | null;
  state: CiState;
  done: number | null;
  total: number | null;
  reason: string | null;
  source: 'deliver' | 'ci-gate' | 'stop-check';
  jobs?: DeliveryCiJob[];
  at: string;
}

export interface ShipPatch {
  push?: Omit<DeliveryPush, 'at'>;
  pr?: Partial<Omit<DeliveryPr, 'at'>>;
  ci?: Omit<DeliveryCi, 'at'>;
}

export interface DeliveryRecord extends Partial<
  Omit<EnvelopeHeader, 'schema_version' | 'doc_type'>
> {
  schema_version: number;
  doc_type: typeof DELIVERY_DOC_TYPE;
  commits: DeliveryCommit[];
  head_sha: string | null;
  merge_commit: string | null;
  branch?: string | null;
  base_branch?: string | null;
  captured_at?: string | null;
  commit_decision?: CommitDecision;
  last_link_attempt?: string | null;
  start_commit?: string | null;
  commit_split?: CommitSplit | null;
  push?: DeliveryPush | null;
  pr?: DeliveryPr | null;
  ci?: DeliveryCi | null;
}

export function emptyCommitDecision(): CommitDecision {
  return { asked: false, answer: null, recorded_at: null };
}

function emptyDelivery(): DeliveryRecord {
  return {
    schema_version: DELIVERY_SCHEMA_VERSION,
    doc_type: DELIVERY_DOC_TYPE,
    commits: [],
    head_sha: null,
    merge_commit: null,
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

export function readFeatureDelivery(projectRoot: string, dirName: string): DeliveryRecord {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'delivery')), 'utf8'),
    ) as unknown;
    if (isDelivery(parsed)) return parsed;
  } catch {}
  return emptyDelivery();
}

export function writeFeatureDelivery(
  projectRoot: string,
  dirName: string,
  record: DeliveryRecord,
  recordedAt?: string,
  sessionId?: string | null,
): DeliveryRecord {
  if (record.branch || record.base_branch) {
    const current = readFeatureRecord(projectRoot, dirName);
    recordBranch(
      projectRoot,
      dirName,
      current?.branch ? null : record.branch,
      current?.base_branch ? null : record.base_branch,
    );
  }
  const stamped = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: DELIVERY_DOC_TYPE,
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    sessionId,
    now: recordedAt === undefined ? undefined : () => new Date(recordedAt),
    body: {
      commits: record.commits,
      head_sha: record.head_sha,
      merge_commit: record.merge_commit,
      commit_decision: record.commit_decision ?? emptyCommitDecision(),
      last_link_attempt: record.last_link_attempt ?? null,
      start_commit: record.start_commit ?? null,
      commit_split: record.commit_split ?? null,
      push: record.push ?? null,
      pr: record.pr ?? null,
      ci: record.ci ?? null,
    },
  }) as DeliveryRecord;
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'delivery')), stamped);
  return stamped;
}

export function featureDeliveryBranch(projectRoot: string, dirName: string): string | null {
  return (
    readChangeConstants(projectRoot, dirName).branch ??
    readFeatureDelivery(projectRoot, dirName).branch ??
    null
  );
}

function recordBranch(
  projectRoot: string,
  dirName: string,
  branch: string | null | undefined,
  baseBranch?: string | null,
): void {
  const patch: { branch?: string; base_branch?: string } = {};
  if (branch) patch.branch = branch;
  if (baseBranch) patch.base_branch = baseBranch;
  if (Object.keys(patch).length > 0) {
    updateFeatureRecord(projectRoot, dirName, patch);
  }
}

export function refreshCommitSplit(
  projectRoot: string,
  dirName: string,
  record: DeliveryRecord,
): DeliveryRecord {
  try {
    const feature = readFeatureRecord(projectRoot, dirName);
    record.commit_split = computeCommitSplit(projectRoot, {
      baseBranch: feature?.base_branch ?? undefined,
      startCommit: record.start_commit ?? null,
      ownTickets: changeOwnTickets(feature?.issue, feature?.branch ?? null),
    });
    /* v8 ignore next -- best-effort: a git fault leaves the previous split in place. */
  } catch {}
  return record;
}

export function seedFeatureDelivery(
  projectRoot: string,
  dirName: string,
  input: { sessionId: string; recordedAt: string; startCommit?: string | null },
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.commit_decision = record.commit_decision ?? emptyCommitDecision();
  if (!record.start_commit && input.startCommit) record.start_commit = input.startCommit;
  refreshCommitSplit(projectRoot, dirName, record);
  return writeFeatureDelivery(projectRoot, dirName, record, input.recordedAt, input.sessionId);
}

export function setCommitDecision(
  projectRoot: string,
  dirName: string,
  answer: CommitDecisionAnswer,
  recordedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.commit_decision = { asked: answer !== 'user-requested', answer, recorded_at: recordedAt };
  return writeFeatureDelivery(projectRoot, dirName, record, recordedAt);
}

export function recordLinkAttempt(
  projectRoot: string,
  dirName: string,
  reason: string,
  capturedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.last_link_attempt = `${capturedAt}: ${reason}`;
  return writeFeatureDelivery(projectRoot, dirName, record, capturedAt);
}

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
  return writeFeatureDelivery(projectRoot, dirName, record, capturedAt);
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
  recordBranch(projectRoot, dirName, state.branch, state.base_branch);
  record.head_sha = state.head_commit ?? record.head_sha;
  refreshCommitSplit(projectRoot, dirName, record);
  return writeFeatureDelivery(projectRoot, dirName, record, capturedAt);
}

export function stampMergeCommit(
  projectRoot: string,
  dirName: string,
  mergeSha: string,
  capturedAt: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.merge_commit = mergeSha;
  return writeFeatureDelivery(projectRoot, dirName, record, capturedAt);
}

export function resolveDeliveryFeatureByBranch(
  projectRoot: string,
  branch: string,
  activeDirName?: string | null,
): string | null {
  const matches = listFeatureDirs(projectRoot).filter(
    (dirName) => featureDeliveryBranch(projectRoot, dirName) === branch,
  );
  if (matches.length === 0) return null;
  if (activeDirName && matches.includes(activeDirName)) return activeDirName;
  const newest = (dirs: string[]): string | null =>
    [...dirs].sort((x, y) => featureChangeKey(x).localeCompare(featureChangeKey(y))).at(-1) ?? null;
  const notDone = matches.filter(
    (dirName) => !isFeatureFinished(readFeatureRecord(projectRoot, dirName)?.status),
  );
  return newest(notDone.length > 0 ? notDone : matches);
}

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
  if (featureDeliveryBranch(projectRoot, dirName) === null) {
    recordBranch(projectRoot, dirName, branch);
  }
  if (!record.commits.some((c) => c.sha === commit.sha)) {
    record.commits.push(commit);
  }
  record.head_sha = commit.sha;
  refreshCommitSplit(projectRoot, dirName, record);
  writeFeatureDelivery(projectRoot, dirName, record, capturedAt);
  return dirName;
}

const CI_RANK: Record<CiState, number> = { pass: 2, fail: 2, pending: 1, unknown: 0 };

function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function mergeCi(previous: DeliveryCi | null | undefined, next: DeliveryCi): DeliveryCi {
  if (!previous || previous.sha !== next.sha) return next;
  if (CI_RANK[next.state] < CI_RANK[previous.state]) return previous;
  return { ...previous, ...definedFields(next) };
}

export function recordShip(
  projectRoot: string,
  dirName: string,
  patch: ShipPatch,
  at: string,
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  if (patch.push)
    record.push = { ...record.push, ...definedFields(patch.push), at } as DeliveryPush;
  if (patch.pr) {
    record.pr = {
      number: null,
      url: null,
      draft: null,
      ...record.pr,
      ...definedFields(patch.pr),
      at,
    };
  }
  if (patch.ci) record.ci = mergeCi(record.ci, { ...patch.ci, at });
  return writeFeatureDelivery(projectRoot, dirName, record, at);
}
