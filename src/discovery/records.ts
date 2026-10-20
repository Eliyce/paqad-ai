import type { EnvelopeHeader } from '@/feature-evidence/envelope.js';

import type { DiscoveryOutcome, DiscoveryRunStatus } from './types.js';

export interface DiscoveryRunBody {
  workflow: 'discovery';
  title: string;
  slug: string;
  issue: string | null;
  revision: number;
  status: DiscoveryRunStatus;
  outcome: DiscoveryOutcome | null;
  adapter: string;
  opened_at: string;
  updated_at: string;
}

export type DiscoveryRunRecord = EnvelopeHeader & DiscoveryRunBody;

export interface DiscoveryBriefBody {
  revision: number;
  intent: string;
  facts: string[];
  interpretations: string[];
  success: string[];
  constraints: string[];
  open_questions: string[];
  assignments: string[];
}

export type DiscoveryBriefRecord = EnvelopeHeader & DiscoveryBriefBody;

export interface DiscoverySourceRow {
  source_id: string;
  title: string;
  reference: string | null;
  kind: string;
  retrieved_at: string;
  finding: string;
  uncertainty: string | null;
  counterevidence: string | null;
}

export interface DiscoveryContributionRow {
  expert_role: string;
  expert_version: string | null;
  assignment: string;
  findings: string[];
  references: string[];
  uncertainty: string | null;
  conflicts: string[];
  status: string;
}

export interface DiscoverySynthesisBody {
  revision: number;
  summary: string;
  complementary: string[];
  conflicts: string[];
  recommendation: string;
  alternatives: string[];
}

export type DiscoverySynthesisRecord = EnvelopeHeader & DiscoverySynthesisBody;

export interface DiscoveryDecisionRef {
  id: string;
  category: string;
  chosen: string;
  rationale: string;
}

export interface DiscoveryDecisionsBody {
  revision: number;
  decisions: DiscoveryDecisionRef[];
}

export type DiscoveryDecisionsRecord = EnvelopeHeader & DiscoveryDecisionsBody;

export interface DiscoveryReadinessBody {
  revision: number;
  outcome: DiscoveryOutcome;
  verdict: string;
  blockers: string[];
  owners: string[];
}

export type DiscoveryReadinessRecord = EnvelopeHeader & DiscoveryReadinessBody;

export interface DiscoveryHandoffBody {
  revision: number;
  outcome: DiscoveryOutcome;
  value: string;
  scope: string;
  success: string[];
  constraints: string[];
  scenarios: string[];
  decisions: string[];
  open_work: string[];
  next_action: string;
  authorization: string;
}

export type DiscoveryHandoffRecord = EnvelopeHeader & DiscoveryHandoffBody;

export interface DiscoveryContextReceiptRow {
  stage: string;
  items: string[];
  mode: string;
  reason: string | null;
}

export interface DiscoveryBlockerRow {
  stage: string;
  description: string;
  owner: string | null;
  resolved: boolean;
}
