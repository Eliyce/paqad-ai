import type { VerificationCriterion } from './planning.js';
import type { AgentRole } from './agent.js';
import type { PipelineConfig } from '@/spec-pipeline/config.js';
import type {
  ClarityLabel,
  GroundingPath,
  GroundingReference,
  VocabularyEntry,
} from '@/spec-pipeline/types.js';
import type { FindingKind, FindingSeverity } from '@/spec-pipeline/experts/types.js';
import type { FinishOutcome, QuestionCounts } from '@/spec-pipeline/finish.js';
import type { TraceArtifact } from '@/spec-pipeline/trace.js';

export interface SpecProvenance {
  pipeline_produced: boolean;
  run_dir?: string;
  label?: ClarityLabel;
  grounding?: { sparse: boolean; path: GroundingPath };
  questions?: QuestionCounts;
  experts?: {
    roles: AgentRole[];
    accepted: number;
    declined: number;
    conflicts: number;
    auto_resolved: number;
    standing?: number;
    renamed?: number;
  };
  findings?: AcceptedFinding[];
  trace?: TraceArtifact;
  manual_reason?: string;
}

export interface AcceptedFinding {
  id: string;
  role: AgentRole;
  kind: FindingKind;
  severity: FindingSeverity;
  target: string;
  claim: string;
}

export interface SpecTaskSection {
  intent: string;
  scope: Record<string, unknown>;
}

export interface SpecGroundingSection {
  path: GroundingPath;
  sparse: boolean;
  references: GroundingReference[];
  vocabulary?: VocabularyEntry[];
}

export interface SpecPipelineSection {
  produced: boolean;
  outcome?: FinishOutcome;
  reason?: string;
  a5_live?: boolean;
  enforcement?: Omit<PipelineConfig, 'enabled' | 'grounding_budget_ms' | 'experts_lanes'>;
  manual_reason?: string;
  skipped?: 'fast-lane';
  experts?: {
    roles: AgentRole[];
    accepted: number;
    declined: number;
    conflicts: number;
    auto_resolved: number;
    standing: number;
    on_call: string[];
    renamed: number;
  };
  findings?: AcceptedFinding[];
}

export type SpecTraceMap = Record<string, string>;

export type FeatureSpecInvariantSource = 'compiled-rule' | 'module-rule' | 'authored';

export interface FeatureSpecInvariant {
  invariant_id: string;
  statement: string;
  source: FeatureSpecInvariantSource;
  rule_id?: string;
  confirmed: boolean;
}

export interface FrozenSpecMetadata {
  frozen_at: string;
  spec_hash: string;
  signed_off_by: string;
}

export interface SpecReviewSummary {
  reviewed_at: string;
  defect_count: number;
  by_severity: {
    critical: number;
    major: number;
    minor: number;
  };
}

export interface FeatureSpec {
  schema_version: string | number;
  spec_id: string;
  spec_file: string;
  spec_hash: string;
  behaviour: string[];
  acceptance_criteria: VerificationCriterion[];
  invariants: FeatureSpecInvariant[];
  open_questions: string[];
  frozen: FrozenSpecMetadata | null;
  spec_review?: SpecReviewSummary;
  non_goals?: string[];
  task?: SpecTaskSection;
  grounding?: SpecGroundingSection;
  pipeline?: SpecPipelineSection;
  trace?: SpecTraceMap;
  provenance?: SpecProvenance;
}

export interface SpecFreezeEvaluation {
  can_freeze: boolean;
  blockers: string[];
}

export interface DoneCriterionState {
  criterion_id: string;
  proof_passing: boolean;
}

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
