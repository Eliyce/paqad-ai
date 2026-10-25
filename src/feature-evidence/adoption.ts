import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGitState } from '@/rag/git-state.js';
import { readUnitFile } from '@/session-ledger/ledger.js';

import { rowRecordedAt } from './envelope.js';
import { listFeatureDirs } from './enumerate.js';
import { readChangeConstants, readFeatureRecord } from './feature-record.js';
import { featureFilePath } from './paths.js';
import { readSessionControl, writeSessionControl } from './session-control.js';

function stageRows(projectRoot: string, dirName: string) {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'stageEvidence'));
}

export function isBundleMaterialized(projectRoot: string, dirName: string): boolean {
  return stageRows(projectRoot, dirName).length > 0;
}

export function isBundleClosed(projectRoot: string, dirName: string): boolean {
  let closed = false;
  for (const row of stageRows(projectRoot, dirName)) {
    if (row.kind === 'open') {
      closed = false;
    } else if (row.kind === 'close') {
      closed = true;
    }
  }
  return closed;
}

export function featureBranch(
  projectRoot: string,
  dirName: string,
  rows = stageRows(projectRoot, dirName),
): string | null {
  return (
    readChangeConstants(projectRoot, dirName, rows).branch ?? deliveryBranch(projectRoot, dirName)
  );
}

function deliveryBranch(projectRoot: string, dirName: string): string | null {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'delivery')), 'utf8'),
    );
    const branch = (raw as { branch?: unknown }).branch;
    return typeof branch === 'string' && branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

export function listAdoptableFeatures(projectRoot: string, branch: string | null): string[] {
  return listFeatureDirs(projectRoot).filter((dirName) => {
    const rows = stageRows(projectRoot, dirName);
    if (rows.length === 0 || rows.some((row) => row.kind === 'close')) {
      return false;
    }
    return branch === null || featureBranch(projectRoot, dirName, rows) === branch;
  });
}

export function listInFlightFeatures(projectRoot: string): string[] {
  return listAdoptableFeatures(projectRoot, null);
}

export function sessionClosedAnyFeature(projectRoot: string, sessionId: string): boolean {
  return listFeatureDirs(projectRoot).some((dirName) =>
    stageRows(projectRoot, dirName).some(
      (row) => row.kind === 'close' && row.session_id === sessionId,
    ),
  );
}

export function sessionReattachableFeature(
  projectRoot: string,
  sessionId: string,
  branch: string | null,
): string | null {
  if (branch === null) {
    return null;
  }
  let picked: string | null = null;
  let pickedAt = '';
  for (const dirName of listFeatureDirs(projectRoot)) {
    const rows = stageRows(projectRoot, dirName);
    if (!rows.some((row) => row.kind === 'open' && row.session_id === sessionId)) continue;
    if (!isBundleClosed(projectRoot, dirName)) continue;
    if (featureBranch(projectRoot, dirName, rows) !== branch) continue;
    if (readFeatureRecord(projectRoot, dirName)?.status === 'abandoned') continue;
    const lastAt = rows.reduce((newest, row) => {
      const at = rowRecordedAt(row) ?? '';
      return at > newest ? at : newest;
    }, '');
    if (picked === null || lastAt > pickedAt) {
      picked = dirName;
      pickedAt = lastAt;
    }
  }
  return picked;
}

export function reconcileSessionControl(
  projectRoot: string,
  sessionId: string,
  now?: () => Date,
): string | null {
  const control = readSessionControl(projectRoot, sessionId, now);
  const activeClosed =
    control.active !== null &&
    isBundleMaterialized(projectRoot, control.active) &&
    isBundleClosed(projectRoot, control.active);
  if (
    control.active !== null &&
    isBundleMaterialized(projectRoot, control.active) &&
    !activeClosed
  ) {
    return control.active;
  }

  const branch = readGitState(projectRoot).branch ?? null;
  const candidates = listAdoptableFeatures(projectRoot, branch).filter(
    (name) => !control.paused.includes(name),
  );
  const fallback = activeClosed ? null : control.active;
  if (candidates.length !== 1) {
    if (activeClosed) {
      writeSessionControl(projectRoot, { ...control, active: null }, now, 'reconcile');
    }
    return fallback;
  }

  const adopted = candidates[0]!;
  writeSessionControl(projectRoot, { ...control, active: adopted }, now, 'reconcile');
  return adopted;
}

export function adoptableInFlightOnBranch(
  projectRoot: string,
  sessionId: string,
  now?: () => Date,
): string[] {
  const control = readSessionControl(projectRoot, sessionId, now);
  const branch = readGitState(projectRoot).branch ?? null;
  return listAdoptableFeatures(projectRoot, branch).filter(
    (name) => !control.paused.includes(name),
  );
}
