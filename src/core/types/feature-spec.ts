import type { VerificationCriterion } from './planning.js';
import type { AgentRole } from './agent.js';
import type { PipelineConfig } from '@/spec-pipeline/config.js';
import type { ClarityLabel, GroundingPath, GroundingReference } from '@/spec-pipeline/types.js';
import type { FinishOutcome, QuestionCounts } from '@/spec-pipeline/finish.js';
import type { TraceArtifact } from '@/spec-pipeline/trace.js';

/**
 * How a spec frozen before issue #581 recorded that it was produced (issue #547, FR-9.1). No
 * writer produces it any more: a record frozen since #581 carries the `task`, `grounding`,
 * `pipeline` and `trace` sections instead, and no `run_dir` (D6). Readers still accept it on an
 * old record (INV-8).
 */
export interface SpecProvenance {
  /** Whether the spec pipeline crafted this spec. */
  pipeline_produced: boolean;
  /** The run scratch directory the provenance was read from. */
  run_dir?: string;
  /** The S1 clarity label the run recorded. */
  label?: ClarityLabel;
  /** The grounding shape: whether the touched area was sparse, and which path grounded it. */
  grounding?: { sparse: boolean; path: GroundingPath };
  /** The S2 question counts (asked / answered / auto-answered / deferred). */
  questions?: QuestionCounts;
  /** The experts consulted and how their notes fared. */
  experts?: {
    roles: AgentRole[];
    accepted: number;
    declined: number;
    conflicts: number;
    auto_resolved: number;
  };
  /** The traceability artifact tying every spec line to its source (issue #547, FR-8.2). */
  trace?: TraceArtifact;
  /** Why the spec was frozen without the pipeline, under strict adoption (FR-9.3). */
  manual_reason?: string;
}

/** The `task` section: what the pipeline's task step said the change is for (issue #581). */
export interface SpecTaskSection {
  intent: string;
  scope: Record<string, unknown>;
}

/**
 * The `grounding` section: which path grounded the request, whether the area was thin, and the
 * references it read. The terms the plain-language checks use stay in staging (issue #581).
 */
export interface SpecGroundingSection {
  path: GroundingPath;
  sparse: boolean;
  references: GroundingReference[];
}

/**
 * The `pipeline` section (issue #581, D4): whether the spec pipeline produced the spec, and how
 * its run finished. The enforcement settings are stored here once and nowhere else in the bundle.
 * A spec frozen without the pipeline while it was enabled records `produced: false`, with
 * `manual_reason` when it was frozen with `--manual --reason`.
 */
export interface SpecPipelineSection {
  produced: boolean;
  outcome?: FinishOutcome;
  reason?: string;
  a5_live?: boolean;
  enforcement?: Omit<PipelineConfig, 'enabled'>;
  manual_reason?: string;
}

/**
 * The `trace` map (issue #581, owner decision D-01M3BJWGYHMZ6JHSEE09QTS4FM): every requirement
 * id (`FR-n`, `NFR-n`, `AC-n`, `INV-n`) mapped to where it came from, `ticket:<section>` or an
 * `EX-*` finding id in `experts.json`.
 */
export type SpecTraceMap = Record<string, string>;

/**
 * Where an invariant ("a rule the feature must never break") came from. Compiled
 * rules and module business rules are auto-suggested at spec-build time; the
 * human can also author one directly. Every invariant must be human-confirmed
 * before the spec can be frozen (issue #102, Open Decision 2).
 */
export type FeatureSpecInvariantSource = 'compiled-rule' | 'module-rule' | 'authored';

export interface FeatureSpecInvariant {
  invariant_id: string;
  statement: string;
  source: FeatureSpecInvariantSource;
  rule_id?: string;
  confirmed: boolean;
}

/**
 * Snapshot written when a spec is frozen. `spec_hash` pins the exact source
 * markdown the freeze signed off on, so any later edit to the markdown is
 * detectable as drift.
 */
export interface FrozenSpecMetadata {
  frozen_at: string;
  spec_hash: string;
  signed_off_by: string;
}

/**
 * What the spec-quality review found at freeze time, folded into the frozen record
 * (issue #401). Freeze runs the review itself and blocks on a critical defect, so this
 * summary is the evidence that it ran — it travels with the spec of record instead of
 * living in a separate `.paqad/compliance/<slug>/spec-review.json` the feature-development
 * flow had to produce by hand. Counts are of OPEN defects; a resolved defect is excluded,
 * matching the freeze evaluation's own semantics.
 */
export interface SpecReviewSummary {
  reviewed_at: string;
  defect_count: number;
  by_severity: {
    critical: number;
    major: number;
    minor: number;
  };
}

/**
 * The structured, machine-checkable sidecar generated from a human-readable
 * `.paqad/specs/S-<id>-<slug>.md`. It is rebuilt from the markdown on every
 * freeze (never hand-maintained) so it cannot drift from the source of truth.
 */
export interface FeatureSpec {
  /**
   * `'1'` on the builder's output and on a pre-#581 `specification.json`; the bundle record
   * written since issue #581 carries the envelope header, whose `schema_version` is the number 2.
   */
  schema_version: string | number;
  spec_id: string;
  /**
   * The source the spec was built from. In a bundle record written since issue #581 it is
   * always the bundle-relative `spec.md`; an older record names the project-relative source.
   */
  spec_file: string;
  spec_hash: string;
  behaviour: string[];
  acceptance_criteria: VerificationCriterion[];
  invariants: FeatureSpecInvariant[];
  open_questions: string[];
  frozen: FrozenSpecMetadata | null;
  /**
   * Set by `freezeSpec` when a spec-quality review was run for the freeze. Absent on
   * records frozen before issue #401, so readers must tolerate its absence.
   */
  spec_review?: SpecReviewSummary;
  /**
   * Things the change deliberately does NOT do, parsed tolerantly from a `## Non-goals`
   * section of the spec markdown (issue #512, Part B FR-6.4). Optional and additive: a
   * spec authored without the section simply omits it, so pre-#512 records still read and
   * freeze unchanged.
   */
  non_goals?: string[];
  /** The pipeline's task section (issue #581). Only on a spec the pipeline produced. */
  task?: SpecTaskSection;
  /** The pipeline's grounding section (issue #581). Only on a spec the pipeline produced. */
  grounding?: SpecGroundingSection;
  /** How the spec was produced (issue #581). Set only while the spec pipeline is enabled. */
  pipeline?: SpecPipelineSection;
  /** Where each requirement came from (issue #581). Only on a spec the pipeline produced. */
  trace?: SpecTraceMap;
  /** Read-only: a record frozen before issue #581. Never written any more. */
  provenance?: SpecProvenance;
}

/**
 * Result of checking whether a spec may be frozen. `can_freeze` is true only
 * when `blockers` is empty.
 */
export interface SpecFreezeEvaluation {
  can_freeze: boolean;
  blockers: string[];
}

/** A single acceptance criterion paired with whether its proof currently passes. */
export interface DoneCriterionState {
  criterion_id: string;
  proof_passing: boolean;
}

/**
 * A self-review / triage finding. `kind: 'taste'` findings are style/taste and
 * never block "done" (issue #102 — style/taste never blocks). Any other kind
 * blocks only once it is `confirmed`.
 */
export interface DoneFinding {
  id: string;
  kind: string;
  confirmed: boolean;
}

export interface DoneInput {
  gates_passed: boolean;
  acceptance_criteria: DoneCriterionState[];
  findings: DoneFinding[];
}

export interface DoneResult {
  done: boolean;
  gates_passed: boolean;
  failing_criteria: string[];
  blocking_findings: string[];
}
