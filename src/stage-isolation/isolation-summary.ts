// What stage isolation saved for one change (issue #581, D9, AC-14).
//
// Each dispatched stage agent's SubagentStop appends one `kind: 'stage-agent'` row to the
// bundle's `stage-evidence.jsonl`. This module reads those rows back for the two places
// that need them: the completeness gate (were the stage agents recorded at all?) and the
// receipt's `context:` line (how many stages ran isolated, and how much carried history the
// orchestrator did not re-send).
//
// Readers accept the old shape too (INV-8): a bundle written before #581 kept the same facts
// in its own `context-efficiency.jsonl`, so when a bundle has no stage-agent rows that file
// is read instead. Nothing writes it any more (INV-9).

import { featureDir } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { readUnitFile, type SessionLedgerRow } from '@/session-ledger/ledger.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

/** The pre-#581 per-bundle isolation stream, read only for old bundles. */
export const LEGACY_CONTEXT_EFFICIENCY_FILE = 'context-efficiency.jsonl';

/** One change's isolation footprint, as the receipt reports it. */
export interface StageIsolationSummary {
  /** Distinct stages that ran in their own stage agent. */
  stages: number;
  /** Carried history the orchestrator did not re-send, summed across stage agents. */
  tokensNotRecarried: number;
  /** True when any figure behind the total was estimated rather than host-reported. */
  estimate: boolean;
}

/** The bundle's `stage-agent` rows, oldest first. */
export function readStageAgentRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readFeatureStageUnit(projectRoot, dirName).filter((row) => row.kind === STAGE_AGENT_KIND);
}

function legacyRows(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, `${featureDir(dirName)}/${LEGACY_CONTEXT_EFFICIENCY_FILE}`);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * True when the bundle recorded at least one isolated stage agent: a `stage-agent` row, or
 * for a bundle written before #581 a row in its `context-efficiency.jsonl`.
 */
export function hasStageAgentEvidence(projectRoot: string, dirName: string): boolean {
  return (
    readStageAgentRows(projectRoot, dirName).length > 0 ||
    legacyRows(projectRoot, dirName).length > 0
  );
}

/**
 * Summarise what isolation saved for a change, or null when no stage agent was recorded (the
 * receipt then prints no `context:` line rather than a misleading zero). Stage-agent rows are
 * read first; an old bundle's `context-efficiency.jsonl` is the fallback.
 */
export function summarizeStageIsolation(
  projectRoot: string,
  dirName: string,
): StageIsolationSummary | null {
  const rows = readStageAgentRows(projectRoot, dirName);
  if (rows.length > 0) {
    return {
      stages: new Set(rows.map((row) => String(row.stage))).size,
      tokensNotRecarried: rows.reduce((sum, row) => sum + count(row.tokens_not_recarried), 0),
      estimate: rows.some((row) => row.estimate !== false),
    };
  }
  const legacy = legacyRows(projectRoot, dirName);
  if (legacy.length === 0) {
    return null;
  }
  return {
    stages: new Set(legacy.map((row) => String(row.stage))).size,
    tokensNotRecarried: legacy.reduce(
      (sum, row) => sum + count(row.carried_history_avoided_estimate),
      0,
    ),
    // The legacy carried-history figure was always an estimate.
    estimate: true,
  };
}

/** The receipt line, in the words the narration contract fixes. */
export function formatStageIsolationLine(summary: StageIsolationSummary): string {
  const plural = summary.stages === 1 ? 'stage' : 'stages';
  const provenance = summary.estimate ? 'estimate' : 'exact';
  return `context: ${summary.stages} ${plural} isolated, ~${summary.tokensNotRecarried} tokens not re-carried (${provenance})`;
}
