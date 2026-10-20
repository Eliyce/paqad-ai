import { execFileSync } from 'node:child_process';

import { readHeadRef } from '@/rag/git-state.js';

import { featureBranch, isBundleClosed, isBundleMaterialized } from './adoption.js';
import { readFeatureDelivery } from './delivery.js';
import { rowRecordedAt } from './envelope.js';
import { listFeatureDirs } from './enumerate.js';
import { isFeatureFinished, readFeatureRecord, updateFeatureRecord } from './feature-record.js';
import { appendFeatureStageRow, readFeatureStageUnit } from './stage-ledger.js';

export const ABANDON_QUIET_MS = 24 * 60 * 60 * 1000;
export const ABANDON_SESSION_ID = 'paqad-housekeeping';

export type GitRunner = (projectRoot: string, args: string[]) => string | undefined;

export interface CloseAbandonedOptions {
  now?: () => Date;
  git?: GitRunner;
}

export interface AbandonedBundle {
  dir: string;
  branch: string;
  reason: 'branch gone' | 'branch merged';
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

function newestRowAt(projectRoot: string, dirName: string): number | null {
  let newest: number | null = null;
  for (const row of readFeatureStageUnit(projectRoot, dirName)) {
    const at = Date.parse(rowRecordedAt(row) ?? '');
    if (!Number.isNaN(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

function isMerged(
  projectRoot: string,
  dirName: string,
  branch: string,
  git: GitRunner,
): boolean {
  const delivery = readFeatureDelivery(projectRoot, dirName);
  if (delivery.pr?.state === 'merged') return true;
  if ((delivery.commit_split?.own_shas?.length ?? 0) === 0) return false;
  const base = readFeatureRecord(projectRoot, dirName)?.base_branch ?? 'main';
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

export function closeAbandonedBundles(
  projectRoot: string,
  options: CloseAbandonedOptions = {},
): AbandonedBundle[] {
  const now = options.now ?? (() => new Date());
  const git = options.git ?? defaultGit;
  const current = readHeadRef(projectRoot).branch;
  const quietBefore = now().getTime() - ABANDON_QUIET_MS;
  const candidates = listFeatureDirs(projectRoot).flatMap((dirName) => {
    if (!isBundleMaterialized(projectRoot, dirName) || isBundleClosed(projectRoot, dirName)) {
      return [];
    }
    if (isFeatureFinished(readFeatureRecord(projectRoot, dirName)?.status)) return [];
    const branch = featureBranch(projectRoot, dirName);
    if (branch === null || branch === current) return [];
    const newest = newestRowAt(projectRoot, dirName);
    if (newest === null || newest >= quietBefore) return [];
    return [{ dirName, branch }];
  });
  if (candidates.length === 0) return [];
  const refs = readBranchRefs(projectRoot, git);
  if (refs === null) return [];
  const closed: AbandonedBundle[] = [];
  for (const { dirName, branch } of candidates) {
    const reason = abandonReason(projectRoot, dirName, branch, refs, git);
    if (reason === null) continue;
    appendFeatureStageRow(
      projectRoot,
      ABANDON_SESSION_ID,
      dirName,
      {
        kind: 'close',
        event_status: null,
        note: `abandoned: ${reason}, no row for 24h`,
        agent: 'orchestrator',
      },
      now,
    );
    updateFeatureRecord(projectRoot, dirName, { status: 'abandoned' }, now);
    closed.push({ dir: dirName, branch, reason });
  }
  return closed;
}
