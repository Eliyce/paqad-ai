// Discovery canonical record shapes (issue #597).
//
// The body of each envelope-stamped Discovery artifact. The six-field envelope header
// (schema_version, doc_type, change, session_id, recorded_at, content_hash) is added by the writer
// through the shared feature-evidence envelope, so no body here carries those keys. Substantive
// fields are model-supplied through the CLI input contract; the writer owns everything mechanical.

import type { EnvelopeHeader } from '@/feature-evidence/envelope.js';

import type { DiscoveryOutcome, DiscoveryRunStatus } from './types.js';

/** Body of `run.json` — the run's identity and lifecycle. */
export interface DiscoveryRunBody {
  /** The workflow discriminator. Always `discovery`; the folder name never decides ownership. */
  workflow: 'discovery';
  title: string;
  slug: string;
  issue: string | null;
  /** Monotonic revision, bumped on a material change that invalidates dependent evidence. */
  revision: number;
  status: DiscoveryRunStatus;
  /** The chosen next action, set only at hand-off; null until then. */
  outcome: DiscoveryOutcome | null;
  /** The host adapter that opened the run (claude-code, codex-cli, …). */
  adapter: string;
  /** When the run opened (ISO-8601); carried across re-stamps. */
  opened_at: string;
  /** When the run was last updated (ISO-8601). */
  updated_at: string;
}

export type DiscoveryRunRecord = EnvelopeHeader & DiscoveryRunBody;

/** Body of `brief.json` — the Understand-stage correctable brief. */
export interface DiscoveryBriefBody {
  revision: number;
  /** The intended outcome, in the person's own words. */
  intent: string;
  /** Facts established (not inferences). */
  facts: string[];
  /** Tentative interpretations, held loosely until a consequential commitment. */
  interpretations: string[];
  /** Success criteria across user/business value, experience, and operating expectations. */
  success: string[];
  /** Established or requested constraints. */
  constraints: string[];
  /** Open questions still needing an answer. */
  open_questions: string[];
  /** Bounded investigation assignments for the next decision. */
  assignments: string[];
}

export type DiscoveryBriefRecord = EnvelopeHeader & DiscoveryBriefBody;

/** One row of `sources.jsonl` — an attributable research source (Investigate). */
export interface DiscoverySourceRow {
  /** A stable id for the source within the run. */
  source_id: string;
  title: string;
  /** The URL/CLI/MCP the source came from, or null for an inspected local file. */
  reference: string | null;
  /** fact | report | inference | assumption — the epistemic kind (DW-03). */
  kind: string;
  /** When the source was retrieved/inspected (ISO-8601 date or datetime). */
  retrieved_at: string;
  /** The relevant finding this source supports. */
  finding: string;
  /** Stated uncertainty or limits, or null. */
  uncertainty: string | null;
  /** Counterevidence found, or null. */
  counterevidence: string | null;
}

/** One row of `contributions.jsonl` — a reusable-expert contribution (DW-05). */
export interface DiscoveryContributionRow {
  /** The expert role id (product-owner, application-architect, …). */
  expert_role: string;
  /** The expert definition version, or null when unversioned. */
  expert_version: string | null;
  /** The assignment purpose/scope this contribution answers. */
  assignment: string;
  /** The expert's findings. */
  findings: string[];
  /** Source/rule references by identity. */
  references: string[];
  /** Stated uncertainty, or null. */
  uncertainty: string | null;
  /** Conflicts this expert flags against other contributions. */
  conflicts: string[];
  /** complete | partial | blocked — the contribution status. */
  status: string;
}

/** Body of `synthesis.json` — the chief synthesis of contributions (DW-05). */
export interface DiscoverySynthesisBody {
  revision: number;
  summary: string;
  /** Complementary findings that reinforce each other. */
  complementary: string[];
  /** Contradictions / value tradeoffs preserved for an owner decision. */
  conflicts: string[];
  recommendation: string;
  /** Meaningful alternatives considered. */
  alternatives: string[];
}

export type DiscoverySynthesisRecord = EnvelopeHeader & DiscoverySynthesisBody;

/** One settled Discovery-owned decision, referenced by identity (not a second ledger). */
export interface DiscoveryDecisionRef {
  /** The `D-<ULID>` id minted by the contract-decision writer. */
  id: string;
  category: string;
  chosen: string;
  rationale: string;
}

/** Body of `decisions.json` — the Decide-stage index of settled decisions. */
export interface DiscoveryDecisionsBody {
  revision: number;
  decisions: DiscoveryDecisionRef[];
}

export type DiscoveryDecisionsRecord = EnvelopeHeader & DiscoveryDecisionsBody;

/** Body of `readiness.json` — the Check-readiness verdict (DW-04). */
export interface DiscoveryReadinessBody {
  revision: number;
  /** The next-action outcome this readiness verdict is scoped to. */
  outcome: DiscoveryOutcome;
  /** ready | not_ready | needs_investigation. */
  verdict: string;
  /** Unmet obligations / blockers. */
  blockers: string[];
  /** The owners responsible for each blocker. */
  owners: string[];
}

export type DiscoveryReadinessRecord = EnvelopeHeader & DiscoveryReadinessBody;

/** Body of `handoff.json` — the durable owner summary (DW-04, DW-13). */
export interface DiscoveryHandoffBody {
  revision: number;
  outcome: DiscoveryOutcome;
  value: string;
  scope: string;
  success: string[];
  constraints: string[];
  scenarios: string[];
  /** Decisions and their reasons, by reference. */
  decisions: string[];
  open_work: string[];
  next_action: string;
  /** The authorization for the next action (who authorized what). */
  authorization: string;
}

export type DiscoveryHandoffRecord = EnvelopeHeader & DiscoveryHandoffBody;

/** One row of `context-receipts.jsonl` — an honest stage-local context load receipt (DW-11). */
export interface DiscoveryContextReceiptRow {
  stage: string;
  /** The context items made available/read for the stage. */
  items: string[];
  /** available | read | acknowledged — never a claim of comprehension. */
  mode: string;
  /** Why extra (beyond the stage's bounded default) context was loaded, or null. */
  reason: string | null;
}

/** One row of `blockers.jsonl` — a recorded blocker. */
export interface DiscoveryBlockerRow {
  stage: string;
  description: string;
  owner: string | null;
  resolved: boolean;
}
