export const DISCOVERY_EVIDENCE_DOC_TYPE = 'paqad.discovery-evidence';

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

export const DISCOVERY_SCHEMA_VERSION = 1;

export const DISCOVERY_RUN_STATUSES = [
  'active',
  'waiting_input',
  'paused',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

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
