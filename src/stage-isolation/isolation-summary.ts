// What stage isolation saved for one change (issue #581, D9, AC-14).
//
// Each dispatched stage agent's SubagentStop appends one `kind: 'stage-agent'` row to the
// bundle's `stage-evidence.jsonl`. This module reads those rows back for the two places
// that need them: the completeness gate (were the stage agents recorded at all?) and the
// receipt's `context:` line (how many stages ran isolated, and how much carried history the
// orchestrator did not re-send).
//
// Readers accept the old shape too (INV-8): a bundle written before #581 kept the same facts
// in its own `context-efficiency.jsonl`, which is read alongside the rows. Nothing writes it any more (INV-9).

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
 * receipt then prints no `context:` line rather than a misleading zero).
 *
 * Both sources are read and combined. A change that was upgraded to #581 part-way through
 * has its early stage agents in the old `context-efficiency.jsonl` and its later ones as
 * `stage-agent` rows; reading only the rows would drop the early stages from the count.
 * Each dispatched agent was recorded by exactly one writer, old or new, so adding the two
 * never counts an agent twice.
 */
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
    // The legacy carried-history figure was always an estimate.
    estimate: legacy.length > 0 || rows.some((row) => row.estimate !== false),
  };
}

/** The receipt line, in the words the narration contract fixes. */
export function formatStageIsolationLine(summary: StageIsolationSummary): string {
  const plural = summary.stages === 1 ? 'stage' : 'stages';
  const provenance = summary.estimate ? 'estimate' : 'exact';
  return `context: ${summary.stages} ${plural} isolated, ~${summary.tokensNotRecarried} tokens not re-carried (${provenance})`;
}
