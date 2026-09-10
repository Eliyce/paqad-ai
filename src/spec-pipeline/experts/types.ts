// Expert-roster artifact shapes (issue #521, Phase 2).
//
// These are the shapes the script owns around the ONE model call. The `expert-need-detector`
// skill produces an {@link ExpertNeedArtifact}; the script validates it against the roster
// (need.ts) and never trusts a role the model invented. Notes come back as {@link ExpertNote}s,
// merge into the craft input with conflicts surfaced ({@link ExpertConflict}), and every call is
// self-audited as an {@link ExpertAccounting} row.

import type { AgentRole } from '@/core/types/agent.js';
import type { PipelineQuestion } from '../types.js';

/**
 * The most expert + chief questions that may join the single S2 batch (issue #547, FR-7.2).
 * The label's own `question_budget` bounds the enrichment questions; this bounds the expert
 * and chief questions on top, taken in order (chief gaps first, then experts in need order).
 * Overflow is recorded as `deferred_from_experts`, never silently lost.
 */
export const MAX_EXPERT_QUESTIONS = 5;

/**
 * How a finding maps onto a spec line (issue #547, FR-4.3). `requirement` → FR/NFR,
 * `invariant` → INV, `acceptance` → AC, `risk` → an NFR or a failure-path AC, `non-goal` →
 * the `## Non-goals` section.
 */
export type FindingKind = 'requirement' | 'invariant' | 'acceptance' | 'risk' | 'non-goal';

/** How strongly the expert holds a finding (issue #547, FR-4.3). */
export type FindingSeverity = 'must' | 'should' | 'could';

/** One expert the model decided the request needs, with its plain-language justification. */
export interface ExpertNeed {
  /** The expert role — must be in the roster (AC-8); the script rejects anything else. */
  role: AgentRole;
  /** Why it fired, in the model's own words (recorded for accounting, FR-7). */
  reason: string;
}

/**
 * The `expert-need-detector` skill's output (FR-3). `experts` may be empty — nothing needed ⇒
 * zero experts, zero cost (issue #521 §4). The script validates it; it does not score signals.
 */
export interface ExpertNeedArtifact {
  experts: ExpertNeed[];
}

/** One finding an expert makes about a concrete target (a table, an endpoint, a component). */
export interface ExpertFinding {
  /**
   * The stable finding id, assigned on record as `EX-<role>-<n>` in note order (issue #547,
   * FR-4.4). Optional on the raw skill output (assigned by the script), always present once
   * recorded — the craft trace gate (FR-8.2) and accounting (FR-11.2) key on it.
   */
  id?: string;
  /** What the finding is about — the merge key for conflict detection (FR-6). */
  target: string;
  /** The expert's claim about that target. */
  claim: string;
  /**
   * How the claim maps onto a spec line (issue #547, FR-4.3). Optional on the legacy
   * `{ target, claim }` shape, defaulted to `requirement` on record so old notes still
   * validate.
   */
  kind?: FindingKind;
  /** How strongly the expert holds the claim (issue #547, FR-4.3). Defaulted to `should`. */
  severity?: FindingSeverity;
  /** An optional grounding reference backing the claim (issue #547, FR-4.3). */
  evidence?: string;
}

/**
 * One expert's structured notes for the crafting step (FR-6). Issue #547 adds the expert's
 * own plain-language questions, which join the single S2 batch (FR-7.1).
 */
export interface ExpertNote {
  role: AgentRole;
  findings: ExpertFinding[];
  /** The plain-language questions this expert raised (issue #547, FR-4.3). May be absent. */
  questions?: PipelineQuestion[];
}

/** Two experts making contradictory claims about the same target (AC-4 / FR-6). */
export interface ExpertConflict {
  target: string;
  /** The roles that disagree, and their competing claims, paired by index. */
  roles: AgentRole[];
  claims: string[];
  /**
   * The ids of the findings that clash (issue #547, FR-5.1). Carried so synthesis and the
   * conflict-decision minting can point back at the exact findings, and so accounting can
   * tell whether a conflicted finding reached the spec.
   */
  finding_ids: string[];
}

/** The result of merging expert notes: surviving findings plus any detected conflicts. */
export interface MergedExpertNotes {
  findings: ExpertFinding[];
  conflicts: ExpertConflict[];
}

/**
 * The per-expert context slice size (FR-5). `budget` is the role's canonical budget; `granted`
 * is what the run actually allotted after the ceiling was applied; `clamped` records that the
 * ceiling shrank the slice (never dropping the expert — INV-5).
 */
export interface ExpertSlice {
  role: AgentRole;
  budget: number;
  granted: number;
  clamped: boolean;
}

/** One self-auditing accounting row per expert call (AC-5 / FR-7). */
export interface ExpertAccounting {
  role: AgentRole;
  /** Why it fired (from the need artifact). */
  reason: string;
  /** Tokens the call actually spent. */
  tokens: number;
  /** Whether the expert's notes changed the crafted spec — the retire-on-evidence signal. */
  changed_spec: boolean;
}

/** The whole expert block folded into finish provenance when experts ran (FR-8). */
export interface ExpertRunAccounting {
  experts: ExpertAccounting[];
  /** Total tokens across all experts. */
  total_tokens: number;
  /** Non-blocking warnings (e.g. the token ceiling was exceeded — never a dropped expert). */
  warnings: string[];
}
