import { readFeatureChecks } from '@/checks/report-store.js';
import { liveChecksRunningMarker, type ChecksMarkerProbe } from '@/checks/running-marker.js';
import { sessionClosedAnyFeature } from '@/feature-evidence/adoption.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { agentForWriter } from './agent-identity.js';
import { startedAfterLastEnd } from './fold.js';
import { endStage, openStageEvidence } from './recorder.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { verifyChange, type VerifyResult } from './verify.js';

export interface FinalizeStageEvidenceInput {
  adapter: string;
  sessionId?: string | null;
  changedFilesCount?: number;
  subjectDigest?: string | null;
  isFeatureDevChange?: boolean;
  deferClose?: boolean;
  now?: () => Date;
  probe?: ChecksMarkerProbe;
}

export function finalizeStageEvidence(
  projectRoot: string,
  input: FinalizeStageEvidenceInput,
): VerifyResult | null {
  try {
    if (input.isFeatureDevChange === false) {
      return null;
    }

    const sessionId = resolveSessionId(projectRoot, input.sessionId);
    let dirName = currentFeature(projectRoot, sessionId);

    if (dirName) {
      const existing = readFeatureStageUnit(projectRoot, dirName);
      endDanglingLiveStages(projectRoot, sessionId, dirName, existing, input);
      backfillMissingDevelopment(projectRoot, sessionId, dirName, input);
    } else {
      if (!input.changedFilesCount || input.changedFilesCount <= 0) {
        return null;
      }
      if (sessionClosedAnyFeature(projectRoot, sessionId)) {
        return null;
      }
      dirName = openStageEvidence(projectRoot, {
        sessionId,
        adapter: input.adapter,
        now: input.now,
      }).dirName;
      appendInferredDevelopment(projectRoot, sessionId, dirName, input);
    }

    const result = verifyChange(projectRoot, {
      sessionId,
      dirName,
      adapter: input.adapter,
      now: input.now,
    });

    if (result.ok && !input.deferClose) {
      closeVerifiedChange(projectRoot, {
        sessionId,
        adapter: input.adapter,
        verdict: result.verdict,
        now: input.now,
      });
    }
    return result;
  } catch {
    return null;
  }
}

export interface CloseVerifiedChangeInput {
  sessionId?: string | null;
  adapter: string;
  verdict: string;
  now?: () => Date;
}

export function closeVerifiedChange(projectRoot: string, input: CloseVerifiedChangeInput): void {
  try {
    const sessionId = resolveSessionId(projectRoot, input.sessionId);
    const dirName = currentFeature(projectRoot, sessionId);
    if (!dirName) {
      return;
    }
    appendFeatureStageRow(
      projectRoot,
      sessionId,
      dirName,
      {
        kind: 'close',
        agent: agentForWriter(input.adapter),
        event_status: 'completed',
        note: `closed; verdict=${input.verdict}`,
      },
      input.now,
    );
    closeActiveFeature(projectRoot, sessionId, input.now);
  } catch {}
}

function endDanglingLiveStages(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  rows: readonly SessionLedgerRow[],
  input: FinalizeStageEvidenceInput,
): void {
  const started = new Set<string>();
  for (const row of rows) {
    if (typeof row.stage !== 'string') continue;
    if (row.kind === 'stage_start' && row.evidence_source === 'live-mark') started.add(row.stage);
  }
  for (const stage of started) {
    const stageRows = rows.filter((row) => row.stage === stage);
    if (!startedAfterLastEnd(stageRows)) continue;
    const artifactPaths =
      stage === 'checks' ? checksEndArtifact(projectRoot, sessionId, dirName, stageRows, input) : [];
    if (artifactPaths === null) continue;
    try {
      endStage(
        projectRoot,
        stage,
        artifactPaths.length > 0 ? { artifactPaths } : {},
        {
          sessionId,
          dirName,
          adapter: input.adapter,
          now: input.now,
        },
      );
    } catch {}
  }
}

function checksEndArtifact(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  stageRows: readonly SessionLedgerRow[],
  input: FinalizeStageEvidenceInput,
): string[] | null {
  const probe = input.now ? { ...input.probe, now: input.now } : input.probe;
  if (liveChecksRunningMarker(projectRoot, sessionId, probe) !== null) {
    return null;
  }
  const lastStart = stageRows.filter((row) => row.kind === 'stage_start').at(-1);
  const startedAt = Date.parse((lastStart && rowRecordedAt(lastStart)) ?? '');
  const report = readFeatureChecks(projectRoot, dirName);
  const reportAt = Date.parse(report?.generated_at ?? report?.recorded_at ?? '');
  if (Number.isNaN(startedAt) || Number.isNaN(reportAt) || reportAt < startedAt) {
    return null;
  }
  return [featureFilePath(dirName, 'checks')];
}

function backfillMissingDevelopment(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  input: FinalizeStageEvidenceInput,
): void {
  if (!input.changedFilesCount || input.changedFilesCount <= 0) {
    return;
  }
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const hasDevelopment = rows.some(
    (row) =>
      row.stage === 'development' && (row.kind === 'stage_start' || row.kind === 'stage_end'),
  );
  if (hasDevelopment) {
    return;
  }
  appendInferredDevelopment(projectRoot, sessionId, dirName, input);
}

function appendInferredDevelopment(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  input: FinalizeStageEvidenceInput,
): void {
  appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      kind: 'stage_end',
      agent: agentForWriter(input.adapter),
      stage: 'development',
      event_status: 'inferred',
      evidence_source: 'inferred-git',
      subject_digest: input.subjectDigest ?? null,
    },
    input.now,
  );
}
