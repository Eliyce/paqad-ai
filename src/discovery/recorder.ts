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
  revision: number;
  artifactPath?: string;
  agent?: string;
  now?: () => Date;
}

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

export function readDiscoveryStageRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, discoveryRunFilePath(dirName, 'stageEvidence'));
}
