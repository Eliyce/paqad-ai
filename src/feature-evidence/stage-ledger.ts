// Feature-scoped stage-evidence ledger (issue #339, Phase 2 — additive).
//
// The per-feature bundle keeps a change's stage evidence at
// `<feature-dir>/stage-evidence.jsonl` instead of the legacy
// `paqad.stage-evidence/<session>/<ordinal>.jsonl`. This module resolves the active
// feature for a session (Phase-1 `_session` control), mints one when none is active
// so a stage call never lands on nothing (mirrors the legacy auto-open), and
// reads / appends / folds a feature's stage rows — reusing the session-ledger row
// primitives (issue #339 2a) and the stage-evidence fold core. Additive/dark:
// nothing wires it into the live recorder yet; the cutover does that.

import {
  appendStampedRowToUnit,
  readUnitFile,
  stampSessionRow,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type FoldedChange,
} from '@/stage-evidence/types.js';

import { mintFeatureDirName } from './mint.js';
import { featureFilePath } from './paths.js';
import { readSessionControl, setActiveFeature } from './session-control.js';
import type { FeatureLane } from './types.js';

export interface ResolveFeatureInput {
  /** Explicit feature title → mints a NEW named feature and switches to it. */
  title?: string;
  /** Ticket ref for a titled feature (verbatim, or null to force none). */
  issue?: string | null;
  lane?: FeatureLane;
  /** Deterministic ULID seam for tests. */
  ulid?: string;
  ulidSeed?: number;
  now?: () => Date;
}

/**
 * Resolve the active feature dir name for `sessionId`. An explicit `title` always
 * mints a NEW named feature and switches to it (the "new work" signal); with no title
 * it returns the active feature, or — when none is active — mints an untitled
 * `change-<ULID>` feature so a stage call never lands on nothing (mirrors the legacy
 * auto-open). The minted feature is set active in the `_session` control.
 */
export function resolveActiveFeature(
  projectRoot: string,
  sessionId: string,
  input: ResolveFeatureInput = {},
): string {
  if (input.title !== undefined) {
    return mintAndActivate(projectRoot, sessionId, input.title, input);
  }
  const control = readSessionControl(projectRoot, sessionId, input.now);
  if (control.active) {
    return control.active;
  }
  return mintAndActivate(projectRoot, sessionId, 'change', input);
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

/** Project-relative path to a feature's stage-evidence ledger file. */
export function featureStagePath(dirName: string): string {
  return featureFilePath(dirName, 'stageEvidence');
}

/**
 * Append one stage-evidence row into the feature's bundle (stamped + validated by the
 * existing stage-evidence schema). `conversation_ordinal` is retired as the change key
 * (the feature dir name is the key now) but the row schema still carries it for
 * provenance/back-compat, so a constant `1` is stamped unless the caller overrides it.
 */
export function appendFeatureStageRow(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  row: Record<string, unknown>,
  now?: () => Date,
): SessionLedgerRow {
  const stamped = stampSessionRow(
    STAGE_EVIDENCE_DOC_TYPE,
    sessionId,
    { conversation_ordinal: 1, ...row },
    {
      schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
      validate: (r) => validateStageEvidenceRow(r),
      now,
    },
  );
  appendStampedRowToUnit(projectRoot, featureStagePath(dirName), stamped);
  return stamped;
}

/** Tolerant read of a feature's stage-evidence rows. */
export function readFeatureStageUnit(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureStagePath(dirName));
}

/** Fold a feature's stage rows into the per-change view, keyed by the dir name. */
export function foldFeature(projectRoot: string, sessionId: string, dirName: string): FoldedChange {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  return foldRowsWithKey(rows, { sessionId, changeKey: dirName, promptOrdinal: 0 });
}
