import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readGitState } from '@/rag/git-state.js';

import { stampFeatureDocument } from './bundle-document.js';
import type { EnvelopeHeader } from './envelope.js';
import { listFeatureDirs } from './enumerate.js';
import { readChangeConstants, readFeatureRecord, updateFeatureRecord } from './feature-record.js';
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

export function seedFeatureDelivery(
  projectRoot: string,
  dirName: string,
  input: { sessionId: string; recordedAt: string },
): DeliveryRecord {
  const record = readFeatureDelivery(projectRoot, dirName);
  record.commit_decision = record.commit_decision ?? emptyCommitDecision();
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
    (dirName) => readFeatureRecord(projectRoot, dirName)?.status !== 'done',
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
  writeFeatureDelivery(projectRoot, dirName, record, capturedAt);
  return dirName;
}
