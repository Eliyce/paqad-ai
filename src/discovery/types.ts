// Discovery workflow shared types (issue #597).
//
// The standalone Discovery workflow helps a person move from an uncertain idea or an improvement
// brief to a practical next step, through six enforced, resumable stages. These are its shared
// identifiers and record shapes; the writers, recorder, fold, and validators build on them.
//
// Discovery is DISTINCT from feature-development: its stage set is its own (see stages.ts), its
// evidence rides its own doc type, and its canonical artifacts live under `.paqad/ledger/delivery/`
// (see paths.ts). It reuses the feature-evidence envelope and the generic session-ledger substrate
// but never extends the feature-development stage order or writes into a feature bundle.

/** The stage-evidence JSONL rows for a Discovery run carry this doc type (own ledger). */
export const DISCOVERY_EVIDENCE_DOC_TYPE = 'paqad.discovery-evidence';

/** Envelope doc types for the canonical Discovery artifacts. */
export const DISCOVERY_DOC_TYPES = {
  run: 'paqad.discovery.run',
  brief: 'paqad.discovery.brief',
  source: 'paqad.discovery.source',
  contribution: 'paqad.discovery.contribution',
  synthesis: 'paqad.discovery.synthesis',
  decisions: 'paqad.discovery.decisions',
  readiness: 'paqad.discovery.readiness',
  handoff: 'paqad.discovery.handoff',
  contextReceipt: 'paqad.discovery.context-receipt',
  blocker: 'paqad.discovery.blocker',
  report: 'paqad.discovery.report',
} as const;

export type DiscoveryDocType = (typeof DISCOVERY_DOC_TYPES)[keyof typeof DISCOVERY_DOC_TYPES];

/** The one schema version every Discovery record + stage row carries. */
export const DISCOVERY_SCHEMA_VERSION = 1;

/**
 * A run's EXECUTION status — where the run is right now — kept separate from its OUTCOME (the next
 * action chosen at hand-off). A crash before persistence is never `completed` (DW-12).
 */
export const DISCOVERY_RUN_STATUSES = [
  'active',
  'waiting_input',
  'paused',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

/**
 * A completed hand-off's chosen next action (DW-12, DW-13). Distinct from execution status: a run
 * can be `completed` with any of these outcomes, none of which fabricates downstream build/deploy
 * evidence.
 */
export const DISCOVERY_OUTCOMES = [
  'development',
  'experiment',
  'existing_product',
  'process_change',
  'deferred',
  'stopped',
] as const;
export type DiscoveryOutcome = (typeof DISCOVERY_OUTCOMES)[number];

export function isDiscoveryRunStatus(value: unknown): value is DiscoveryRunStatus {
  return typeof value === 'string' && (DISCOVERY_RUN_STATUSES as readonly string[]).includes(value);
}

export function isDiscoveryOutcome(value: unknown): value is DiscoveryOutcome {
  return typeof value === 'string' && (DISCOVERY_OUTCOMES as readonly string[]).includes(value);
}
