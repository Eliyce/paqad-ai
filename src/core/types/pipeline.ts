import type { ClassificationResult } from './classification.js';
import type { FeatureDevelopmentPolicy } from './feature-development-policy.js';
import type { GateResult } from './verification.js';
import type { VerificationContext } from './verification.js';
import type { Lane } from './routing.js';
import type { ReviewMode, ReviewTier } from './review.js';

export const PIPELINE_PHASES = [
  'request-classification',
  'docs-first-load',
  'analysis',
  'question-answering',
  'root-cause-analysis',
  'pentest',
  'pentest-retest',
  'sequence-planning',
  'specification',
  'user-flow',
  'spec-review',
  'implementation',
  'implementation-review',
  'verification-gates',
  'documentation-update',
  'module-documentation',
] as const;
export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

export interface PhaseResult {
  phase: PipelinePhase;
  status: 'pass' | 'fail' | 'warning';
  summary: string;
  artifacts: string[];
}

export interface CompletedStorySummary {
  id: string;
  title: string;
  verification_status: 'passed' | 'failed' | 'partial';
}

export interface ChangeClosureSummary {
  code_changed: boolean;
  test_evidence_changed: boolean;
  canonical_docs_changed: boolean;
  blocked: boolean;
  primary_blocking_reason: string | null;
  summary: string;
}

export interface HandoffArtifact {
  framework_version: string;
  workflow: ClassificationResult['workflow'];
  current_phase: PipelinePhase;
  current_story: {
    id: string;
    title: string;
  } | null;
  completed_stories: CompletedStorySummary[];
  key_decisions: string[];
  verification_results: GateResult[];
  changed_files: string[];
  context_hit_rate: number;
  warnings: string[];
  unresolved_items: string[];
  closure_summary: ChangeClosureSummary;
  references: {
    spec: string;
    flow: string;
    review_report: string;
  };
}

export interface PipelineRunContext {
  project_root: string;
  lane: Lane;
  classification: ClassificationResult;
  started_at: string;
  phases: PhaseResult[];
  feature_policy: FeatureDevelopmentPolicy | null;
  policy_warnings: string[];
  verification_context?: VerificationContext;
  verification_baseline_results?: GateResult[];
  verification_results?: GateResult[];
}

export interface PipelineAnalysisRole {
  name: string;
}

export interface PipelineResult {
  lane: Lane | null;
  phases: PhaseResult[];
  blocked_at: PipelinePhase | null;
  handoff_path: string;
  analysisRoles: PipelineAnalysisRole[];
  reviewTier: ReviewTier;
  reviewMode?: ReviewMode;
  route_reason?: string | null;
  closure_summary: ChangeClosureSummary;
}
