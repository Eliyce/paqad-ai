// Discovery stage-evidence recorder (issue #597).
//
// Records a Discovery stage boundary (start/end) as one JSONL row in the run's own
// `stage-evidence.jsonl`, on the generic session-ledger substrate (stampSessionRow +
// appendStampedRowToUnit) under the Discovery doc type. This mirrors how feature-development's
// stage-evidence rides the same substrate — but with the SIX Discovery stages, so recording a
// Discovery stage never touches the feature-development ledger and vice versa (FR-3, INV-1).
//
// A thinking stage's `end` may carry an artifact path; the recorder hashes the artifact's real
// on-disk bytes into `artifact_digest` (null when the file is missing or empty), so the fold can
// tell a stage that produced work from a bare marker (DW-08).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendStampedRowToUnit,
  readUnitFile,
  stampSessionRow,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { discoveryRunChangeKey, discoveryRunFilePath } from './paths.js';
import { isKnownDiscoveryStage, type DiscoveryStageId } from './stages.js';
import { DISCOVERY_EVIDENCE_DOC_TYPE, DISCOVERY_SCHEMA_VERSION } from './types.js';

export type DiscoveryStagePhase = 'start' | 'end';

export interface RecordDiscoveryStageInput {
  sessionId: string;
  stage: string;
  phase: DiscoveryStagePhase;
  /** The run's revision at recording time, so a stage row names the revision it proved. */
  revision: number;
  /** Project-relative artifact path (an `end` only); its bytes are hashed. */
  artifactPath?: string;
  /** The agent recording the boundary (orchestrator, or a dispatched stage agent), or undefined. */
  agent?: string;
  now?: () => Date;
}

/**
 * SHA-256 of a project-relative file's bytes, or null when it is missing or empty. The file is read
 * ONCE and its length checked on the returned buffer — never a `statSync` size check before a
 * separate read — so there is no time-of-check/time-of-use window between the two (CWE-367).
 */
function hashArtifact(projectRoot: string, relPath: string): string | null {
  try {
    const bytes = readFileSync(join(projectRoot, relPath));
    if (bytes.length === 0) {
      return null;
    }
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Record one Discovery stage boundary. Returns the stamped row, or null when the stage id is not
 * one of the six Discovery stages (the caller reports the unknown stage). The row lives in the
 * run's `stage-evidence.jsonl`, keyed to the run change (the run ULID) — never a feature bundle.
 */
export function recordDiscoveryStage(
  projectRoot: string,
  dirName: string,
  input: RecordDiscoveryStageInput,
): SessionLedgerRow | null {
  if (!isKnownDiscoveryStage(input.stage)) {
    return null;
  }
  const stage: DiscoveryStageId = input.stage;
  const artifactDigest =
    input.phase === 'end' && input.artifactPath
      ? hashArtifact(projectRoot, input.artifactPath)
      : null;
  const row: Record<string, unknown> = {
    kind: input.phase === 'start' ? 'stage_start' : 'stage_end',
    conversation_ordinal: 1,
    change: discoveryRunChangeKey(dirName),
    stage,
    revision: input.revision,
    ...(input.phase === 'end'
      ? { artifact_path: input.artifactPath ?? null, artifact_digest: artifactDigest }
      : {}),
    ...(input.agent ? { agent: input.agent } : {}),
  };
  const stamped = stampSessionRow(DISCOVERY_EVIDENCE_DOC_TYPE, input.sessionId, row, {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    now: input.now,
  });
  appendStampedRowToUnit(projectRoot, discoveryRunFilePath(dirName, 'stageEvidence'), stamped);
  return stamped;
}

/** Tolerant read of a run's Discovery stage rows (skips malformed lines). */
export function readDiscoveryStageRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, discoveryRunFilePath(dirName, 'stageEvidence'));
}
