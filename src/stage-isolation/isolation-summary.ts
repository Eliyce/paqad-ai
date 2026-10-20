import { featureDir } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { readUnitFile, type SessionLedgerRow } from '@/session-ledger/ledger.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

import { STAGE_AGENT_STAGES } from './stage-agents.js';

export const LEGACY_CONTEXT_EFFICIENCY_FILE = 'context-efficiency.jsonl';

export interface StageIsolationSummary {
  stages: number;
  tokensNotRecarried: number;
  estimate: boolean;
}

function isIsolatedStageRow(row: SessionLedgerRow): boolean {
  return STAGE_AGENT_STAGES.includes(String(row.stage));
}

export function readStageAgentRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter(
    (row) => row.kind === STAGE_AGENT_KIND && isIsolatedStageRow(row),
  );
}

function legacyRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(
    projectRoot,
    `${featureDir(dirName)}/${LEGACY_CONTEXT_EFFICIENCY_FILE}`,
  ).filter(isIsolatedStageRow);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function hasStageAgentEvidence(projectRoot: string, dirName: string): boolean {
  return (
    readStageAgentRows(projectRoot, dirName).length > 0 ||
    legacyRows(projectRoot, dirName).length > 0
  );
}

export function summarizeStageIsolation(
  projectRoot: string,
  dirName: string,
): StageIsolationSummary | null {
  const rows = readStageAgentRows(projectRoot, dirName);
  const legacy = legacyRows(projectRoot, dirName);
  if (rows.length === 0 && legacy.length === 0) {
    return null;
  }
  return {
    stages: new Set([...rows, ...legacy].map((row) => String(row.stage))).size,
    tokensNotRecarried:
      rows.reduce((sum, row) => sum + count(row.tokens_not_recarried), 0) +
      legacy.reduce((sum, row) => sum + count(row.carried_history_avoided_estimate), 0),
    estimate: legacy.length > 0 || rows.some((row) => row.estimate !== false),
  };
}

export function formatStageIsolationLine(summary: StageIsolationSummary): string {
  const plural = summary.stages === 1 ? 'stage' : 'stages';
  const provenance = summary.estimate ? 'estimate' : 'exact';
  return `context: ${summary.stages} ${plural} isolated, ~${summary.tokensNotRecarried} tokens not re-carried (${provenance})`;
}
