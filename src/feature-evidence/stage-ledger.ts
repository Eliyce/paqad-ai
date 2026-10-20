import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGitState } from '@/rag/git-state.js';
import {
  appendStampedRowToUnit,
  readUnitFile,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { augmentWithBundleArtifacts, foldRowsWithKey } from '@/stage-evidence/fold.js';
import { BACKSTOP_WRITER, ORCHESTRATOR_AGENT } from '@/stage-evidence/agent-identity.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type FoldedChange,
} from '@/stage-evidence/types.js';

import { adoptableInFlightOnBranch, isBundleClosed, reconcileSessionControl } from './adoption.js';
import { seedFeatureDelivery } from './delivery.js';
import { listFeatureDirs } from './enumerate.js';
import {
  readChangeConstants,
  seedFeatureRecord,
  updateFeatureRecord,
  type FeatureRecordPatch,
} from './feature-record.js';
import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { stampBundleRow } from './envelope.js';
import { featureChangeKey, featureFilePath, parseFeatureDirName } from './paths.js';
import {
  markDone,
  readSessionControl,
  resumeFeature,
  setActiveFeature,
} from './session-control.js';
import type { FeatureChangeKind, FeatureLane } from './types.js';

export interface ResolveFeatureInput {
  title?: string;
  issue?: string | null;
  lane?: FeatureLane;
  ulid?: string;
  ulidSeed?: number;
  now?: () => Date;
}

export function resolveActiveFeature(
  projectRoot: string,
  sessionId: string,
  input: ResolveFeatureInput = {},
): string {
  if (input.title !== undefined) {
    return mintAndActivate(projectRoot, sessionId, input.title, input);
  }
  const active = reconcileSessionControl(projectRoot, sessionId, input.now);
  if (active) {
    return active;
  }
  const inFlight = adoptableInFlightOnBranch(projectRoot, sessionId, input.now);
  if (inFlight.length >= 2) {
    throw new Error(
      `stage isolation: ${inFlight.length} in-flight feature bundles on this branch ` +
        `(${inFlight.join(', ')}) — a change must keep one identity, so paqad will not mint ` +
        `a third. Close or finish the extra bundle(s), or pass an explicit change (stage ` +
        `start --title …), before continuing.`,
    );
  }
  return mintAndActivate(projectRoot, sessionId, UNTITLED_FEATURE_TITLE, input);
}

function mintAndActivate(
  projectRoot: string,
  sessionId: string,
  title: string,
  input: ResolveFeatureInput,
): string {
  const minted = mintFeatureDirName({
    title,
    issue: input.issue,
    ulid: input.ulid,
    ulidSeed: input.ulidSeed,
  });
  setActiveFeature(projectRoot, sessionId, minted.dirName, { lane: input.lane, now: input.now });
  return minted.dirName;
}

export function featureStagePath(dirName: string): string {
  return featureFilePath(dirName, 'stageEvidence');
}

export function appendFeatureStageRow(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  row: Record<string, unknown>,
  now?: () => Date,
): SessionLedgerRow {
  const stamped = stampBundleRow({
    docType: STAGE_EVIDENCE_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId,
    schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
    row: { ...row, agent: row.agent ?? ORCHESTRATOR_AGENT },
    validate: (r) => validateStageEvidenceRow(r),
    now,
  }) as unknown as SessionLedgerRow;
  appendStampedRowToUnit(projectRoot, featureStagePath(dirName), stamped);
  return stamped;
}

export interface ChangeConstantsInput {
  adapter?: string;
  lane?: FeatureLane;
  branch?: string | null;
  baseBranch?: string | null;
  kind?: FeatureChangeKind;
}

export function recordChangeConstants(
  projectRoot: string,
  dirName: string,
  input: ChangeConstantsInput,
  now?: () => Date,
): void {
  const patch: FeatureRecordPatch = {};
  if (input.adapter && input.adapter !== BACKSTOP_WRITER) patch.adapter = input.adapter;
  if (input.lane) patch.lane = input.lane;
  if (input.branch) patch.branch = input.branch;
  if (input.baseBranch) patch.base_branch = input.baseBranch;
  if (input.kind) patch.kind = input.kind;
  if (Object.keys(patch).length > 0) {
    updateFeatureRecord(projectRoot, dirName, patch, now);
  }
}

export function readFeatureStageUnit(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureStagePath(dirName));
}

export function foldFeature(projectRoot: string, sessionId: string, dirName: string): FoldedChange {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const fold = {
    ...foldRowsWithKey(rows, { sessionId, changeKey: dirName, promptOrdinal: 0 }),
    lane: readChangeConstants(projectRoot, dirName, rows).lane,
  };
  return augmentWithBundleArtifacts(fold, {
    plan: bundleFileNonEmpty(projectRoot, dirName, 'plan'),
    specification: bundleFileNonEmpty(projectRoot, dirName, 'specification'),
  });
}

export function recordedLaneOrFull(
  projectRoot: string,
  sessionId: string,
  dirName: string | null,
): 'fast' | 'graduated' | 'full' {
  if (!dirName) return 'full';
  try {
    return foldFeature(projectRoot, sessionId, dirName).lane ?? 'full';
  } catch {
    return 'full';
  }
}

function bundleFileNonEmpty(
  projectRoot: string,
  dirName: string,
  file: 'plan' | 'specification',
): boolean {
  try {
    return readFileSync(join(projectRoot, featureFilePath(dirName, file))).length > 0;
  } catch {
    return false;
  }
}

export function currentFeature(
  projectRoot: string,
  sessionId: string,
  now?: () => Date,
): string | null {
  return reconcileSessionControl(projectRoot, sessionId, now);
}

export interface OpenFeatureChangeInput extends ResolveFeatureInput {
  adapter: string;
  kind?: FeatureChangeKind;
}

export function openFeatureChange(
  projectRoot: string,
  sessionId: string,
  input: OpenFeatureChangeInput,
): string {
  const dirName = resolveActiveFeature(projectRoot, sessionId, input);
  const gitState = readGitState(projectRoot);
  const seeded = seedFeatureRecord(projectRoot, dirName, {
    adapter: input.adapter,
    sessionId,
    lane: input.lane ?? null,
    branch: gitState.branch ?? null,
    baseBranch: gitState.base_branch ?? null,
    kind: input.kind,
    now: input.now,
  });
  if (seeded) {
    recordChangeConstants(
      projectRoot,
      dirName,
      {
        adapter: input.adapter,
        lane: input.lane ?? null,
        branch: gitState.branch ?? null,
        baseBranch: gitState.base_branch ?? null,
        kind: input.kind,
      },
      input.now,
    );
  }
  const hasOpen = readFeatureStageUnit(projectRoot, dirName).some((row) => row.kind === 'open');
  if (!hasOpen) {
    appendFeatureStageRow(projectRoot, sessionId, dirName, { kind: 'open' }, input.now);
    try {
      seedFeatureDelivery(projectRoot, dirName, {
        sessionId,
        recordedAt: (input.now ?? (() => new Date()))().toISOString(),
        startCommit: gitState.head_commit ?? null,
      });
      /* v8 ignore next 3 -- best-effort: a delivery seed fault must not break feature open. */
    } catch {}
  }
  return dirName;
}

export function closeActiveFeature(projectRoot: string, sessionId: string, now?: () => Date): void {
  const active = currentFeature(projectRoot, sessionId);
  if (!active) {
    return;
  }
  const rows = readFeatureStageUnit(projectRoot, active);
  if (rows.length > 0 && !isBundleClosed(projectRoot, active)) {
    appendFeatureStageRow(
      projectRoot,
      sessionId,
      active,
      {
        kind: 'close',
        event_status: 'completed',
        note: 'closed; active pointer released',
      },
      now,
    );
  }
  updateFeatureRecord(projectRoot, active, { status: 'done' }, now);
  markDone(projectRoot, sessionId, active, now);
}

export function resolveFeatureRef(
  projectRoot: string,
  sessionId: string,
  ref: string,
): string | null {
  const control = readSessionControl(projectRoot, sessionId);
  const known = [...control.paused].reverse();
  if (control.active) {
    known.push(control.active);
  }
  const onDisk = listFeatureDirs(projectRoot).filter((dirName) => !known.includes(dirName));
  const needle = ref.trim().replace(/^#/, '');
  for (const candidates of [known, onDisk]) {
    const match = matchFeatureRef(candidates, ref, needle);
    if (match) {
      return match;
    }
  }
  return null;
}

function matchFeatureRef(
  candidates: readonly string[],
  ref: string,
  needle: string,
): string | null {
  for (const dirName of candidates) {
    if (dirName === ref || dirName === needle) {
      return dirName;
    }
    const parts = parseFeatureDirName(dirName);
    if (!parts) {
      continue;
    }
    if (parts.ulid === needle || parts.issue === needle || parts.slug === needle) {
      return dirName;
    }
  }
  for (const dirName of candidates) {
    const parts = parseFeatureDirName(dirName);
    if (parts && parts.slug.includes(needle)) {
      return dirName;
    }
  }
  return null;
}

export function resumeFeatureByRef(
  projectRoot: string,
  sessionId: string,
  ref: string,
  now?: () => Date,
): string | null {
  const dirName = resolveFeatureRef(projectRoot, sessionId, ref);
  if (!dirName) {
    return null;
  }
  if (isBundleClosed(projectRoot, dirName)) {
    appendFeatureStageRow(
      projectRoot,
      sessionId,
      dirName,
      { kind: 'open', note: 'reopened via resume' },
      now,
    );
    updateFeatureRecord(projectRoot, dirName, { status: 'active' }, now);
  }
  if (resumeFeature(projectRoot, sessionId, dirName, now)) {
    return dirName;
  }
  setActiveFeature(projectRoot, sessionId, dirName, { now, writtenBy: 'resume' });
  return dirName;
}
