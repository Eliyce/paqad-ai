import { rowRecordedAt } from '@/feature-evidence/envelope.js';
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

export function stagesOfRow(row: SessionLedgerRow): string[] {
  const listed = Array.isArray(row.stages) ? row.stages.map(String) : [];
  return [String(row.stage), ...listed].filter((stage) => STAGE_AGENT_STAGES.includes(stage));
}

function isIsolatedStageRow(row: SessionLedgerRow): boolean {
  return stagesOfRow(row).length > 0;
}

export function readStageAgentRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter(
    (row) =>
      row.kind === STAGE_AGENT_KIND && row.event_status !== 'started' && isIsolatedStageRow(row),
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

function agentKey(row: SessionLedgerRow): string | null {
  return typeof row.agent_id === 'string' && row.agent_id.trim() !== ''
    ? row.agent_id.trim()
    : null;
}

function tokensNotRecarried(rows: readonly SessionLedgerRow[]): number {
  const latestByAgent = new Map<string, number>();
  let unkeyed = 0;
  for (const row of rows) {
    const tokens = count(row.tokens_not_recarried);
    const key = agentKey(row);
    if (key === null) {
      unkeyed += tokens;
    } else {
      latestByAgent.set(key, Math.max(latestByAgent.get(key) ?? 0, tokens));
    }
  }
  return [...latestByAgent.values()].reduce((sum, tokens) => sum + tokens, unkeyed);
}

export function hasStageAgentEvidence(projectRoot: string, dirName: string): boolean {
  return (
    readStageAgentRows(projectRoot, dirName).length > 0 ||
    legacyRows(projectRoot, dirName).length > 0
  );
}

export function hasStageAgentEvidenceSince(
  projectRoot: string,
  dirName: string,
  since: string,
): boolean {
  const from = Date.parse(since);
  return readStageAgentRows(projectRoot, dirName).some(
    (row) => Date.parse(rowRecordedAt(row) ?? '') >= from,
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
    stages: new Set([...rows, ...legacy].flatMap(stagesOfRow)).size,
    tokensNotRecarried:
      tokensNotRecarried(rows) +
      legacy.reduce((sum, row) => sum + count(row.carried_history_avoided_estimate), 0),
    estimate: legacy.length > 0 || rows.some((row) => row.estimate !== false),
  };
}

export function formatStageIsolationLine(summary: StageIsolationSummary): string {
  const plural = summary.stages === 1 ? 'stage' : 'stages';
  const provenance = summary.estimate ? 'estimate' : 'exact';
  return `context: ${summary.stages} ${plural} isolated, ~${summary.tokensNotRecarried} tokens not re-carried (${provenance})`;
}
