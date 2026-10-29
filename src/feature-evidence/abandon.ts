import { execFileSync } from 'node:child_process';

import { readHeadRef } from '@/rag/git-state.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { runningStageOfOtherSession } from '@/stage-evidence/stage-agent-holds.js';

import { featureBranch, isBundleClosed, isBundleMaterialized } from './adoption.js';
import { readFeatureDelivery } from './delivery.js';
import { rowRecordedAt } from './envelope.js';
import { listFeatureDirs } from './enumerate.js';
import { isFeatureFinished, readFeatureRecord, updateFeatureRecord } from './feature-record.js';
import { appendFeatureStageRow, readFeatureStageUnit } from './stage-ledger.js';

export const ABANDON_QUIET_MS = 24 * 60 * 60 * 1000;
export const ABANDON_SESSION_ID = 'paqad-housekeeping';
export const MERGE_SUBJECT_MAX_COUNT = 20;
export const MERGE_SUBJECT_SKEW_MS = 24 * 60 * 60 * 1000;

export type GitRunner = (projectRoot: string, args: string[]) => string | undefined;

export interface CloseAbandonedOptions {
  now?: () => Date;
  git?: GitRunner;
}

export interface AbandonedBundle {
  dir: string;
  branch: string;
  reason: 'branch gone' | 'branch merged' | 'pull request merged';
}

const defaultGit: GitRunner = (projectRoot, args) => {
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

interface BranchRefs {
  local: Set<string>;
  remote: Set<string>;
}

function readBranchRefs(projectRoot: string, git: GitRunner): BranchRefs | null {
  const out = git(projectRoot, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes',
  ]);
  if (out === undefined) return null;
  const refs: BranchRefs = { local: new Set(), remote: new Set() };
  for (const ref of out.split('\n').filter(Boolean)) {
    if (ref.startsWith('refs/heads/')) {
      refs.local.add(ref.slice('refs/heads/'.length));
    } else if (ref.startsWith('refs/remotes/')) {
      const rest = ref.slice('refs/remotes/'.length);
      const slash = rest.indexOf('/');
      if (slash > 0) refs.remote.add(rest.slice(slash + 1));
    }
  }
  return refs;
}

function rowSpan(rows: readonly SessionLedgerRow[]): { oldest: number; newest: number } | null {
  let span: { oldest: number; newest: number } | null = null;
  for (const row of rows) {
    const at = Date.parse(rowRecordedAt(row) ?? '');
    if (Number.isNaN(at)) continue;
    span =
      span === null
        ? { oldest: at, newest: at }
        : { oldest: Math.min(span.oldest, at), newest: Math.max(span.newest, at) };
  }
  return span;
}

function baseBranchOf(projectRoot: string, dirName: string): string {
  return readFeatureRecord(projectRoot, dirName)?.base_branch ?? 'main';
}

function squashSubjectOnBase(
  projectRoot: string,
  dirName: string,
  number: number,
  since: number,
  git: GitRunner,
): boolean {
  const base = baseBranchOf(projectRoot, dirName);
  const needle = `(#${number})`;
  const sinceIso = new Date(since - MERGE_SUBJECT_SKEW_MS).toISOString();
  return [`refs/heads/${base}`, `refs/remotes/origin/${base}`].some((ref) => {
    const out = git(projectRoot, [
      'log',
      ref,
      '--fixed-strings',
      `--grep=${needle}`,
      `--since=${sinceIso}`,
      `--max-count=${MERGE_SUBJECT_MAX_COUNT}`,
      '--format=%s',
    ]);
    return out !== undefined && out.split('\n').some((subject) => subject.includes(needle));
  });
}

function confirmedMergeNote(
  projectRoot: string,
  dirName: string,
  since: number,
  git: GitRunner,
): string | null {
  const pr = readFeatureDelivery(projectRoot, dirName).pr;
  const number =
    typeof pr?.number === 'number' && Number.isInteger(pr.number) && pr.number > 0
      ? pr.number
      : null;
  const note = `closed: pull request${number === null ? '' : ` #${number}`} merged`;
  if (pr?.state === 'merged') return note;
  if (number === null) return null;
  return squashSubjectOnBase(projectRoot, dirName, number, since, git) ? note : null;
}

function isMerged(projectRoot: string, dirName: string, branch: string, git: GitRunner): boolean {
  const delivery = readFeatureDelivery(projectRoot, dirName);
  if ((delivery.commit_split?.own_shas?.length ?? 0) === 0) return false;
  const base = baseBranchOf(projectRoot, dirName);
  return git(projectRoot, ['merge-base', '--is-ancestor', branch, base]) !== undefined;
}

function abandonReason(
  projectRoot: string,
  dirName: string,
  branch: string,
  refs: BranchRefs,
  git: GitRunner,
): AbandonedBundle['reason'] | null {
  if (!refs.local.has(branch) && !refs.remote.has(branch)) return 'branch gone';
  return isMerged(projectRoot, dirName, branch, git) ? 'branch merged' : null;
}

function closeBundle(
  projectRoot: string,
  dirName: string,
  note: string,
  status: 'done' | 'abandoned',
  now: () => Date,
): void {
  appendFeatureStageRow(
    projectRoot,
    ABANDON_SESSION_ID,
    dirName,
    { kind: 'close', event_status: null, note, agent: 'orchestrator' },
    now,
  );
  updateFeatureRecord(projectRoot, dirName, { status }, now);
}

export function closeAbandonedBundles(
  projectRoot: string,
  options: CloseAbandonedOptions = {},
): AbandonedBundle[] {
  const now = options.now ?? (() => new Date());
  const git = options.git ?? defaultGit;
  const current = readHeadRef(projectRoot).branch;
  const nowMs = now().getTime();
  const quietBefore = nowMs - ABANDON_QUIET_MS;
  const closed: AbandonedBundle[] = [];
  const candidates = listFeatureDirs(projectRoot).flatMap((dirName) => {
    if (!isBundleMaterialized(projectRoot, dirName) || isBundleClosed(projectRoot, dirName)) {
      return [];
    }
    if (isFeatureFinished(readFeatureRecord(projectRoot, dirName)?.status)) return [];
    const branch = featureBranch(projectRoot, dirName);
    if (branch === null || branch === current) return [];
    const rows = readFeatureStageUnit(projectRoot, dirName);
    const span = rowSpan(rows);
    if (span === null) return [];
    const mergedNote = confirmedMergeNote(projectRoot, dirName, span.oldest, git);
    if (mergedNote !== null) {
      if (runningStageOfOtherSession(rows, null, nowMs) === null) {
        closeBundle(projectRoot, dirName, mergedNote, 'done', now);
        closed.push({ dir: dirName, branch, reason: 'pull request merged' });
      }
      return [];
    }
    if (span.newest >= quietBefore) return [];
    return [{ dirName, branch }];
  });
  if (candidates.length === 0) return closed;
  const refs = readBranchRefs(projectRoot, git);
  if (refs === null) return closed;
  for (const { dirName, branch } of candidates) {
    const reason = abandonReason(projectRoot, dirName, branch, refs, git);
    if (reason === null) continue;
    closeBundle(projectRoot, dirName, `abandoned: ${reason}, no row for 24h`, 'abandoned', now);
    closed.push({ dir: dirName, branch, reason });
  }
  return closed;
}
