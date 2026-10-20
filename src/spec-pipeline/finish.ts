import type { AgentRole } from '@/core/types/agent.js';
import type { SpecPipelineSection } from '@/core/types/feature-spec.js';
import type { SkillModelTier } from '@/core/types/skill.js';

import type { PipelineConfig } from './config.js';
import type { ExpertConflict, ExpertRunAccounting } from './experts/types.js';
import type { ClarityLabel, GroundingPath, PipelineStep } from './types.js';

export type FinishOutcome = 'freeze' | 'non-blocking-review' | 'await-human-approval';

export interface FinishDecision {
  outcome: FinishOutcome;
  reason: string;
}

export function decideFinish(config: PipelineConfig, a5Live: boolean): FinishDecision {
  if (config.final_review === 'strict') {
    return {
      outcome: 'await-human-approval',
      reason: 'final-review is required — a human must approve before freeze',
    };
  }
  if (!a5Live) {
    return {
      outcome: 'non-blocking-review',
      reason:
        'the spec-vs-code check (A5) is not live — showing a non-blocking readable review instead of freezing silently',
    };
  }
  return {
    outcome: 'freeze',
    reason:
      config.final_review === 'warn'
        ? 'A5 is live; final-review is advisory — showing the readable spec, then freezing'
        : 'A5 is live — freezing automatically',
  };
}

export interface QuestionCounts {
  asked: number;
  answered: number;
  auto_answered: number;
  deferred: number;
}

export interface ProvenanceExperts {
  accounting: ExpertRunAccounting;
  conflicts: ExpertConflict[];
}

export interface SpecPipelineMetrics {
  grounding_sparse: boolean;
  grounding_path: GroundingPath;
  label: ClarityLabel;
  signal_count: number;
  questions: QuestionCounts;
  expert_count: number;
  spec_words: number;
  tokens_by_step: Partial<Record<PipelineStep | AgentRole, number>>;
  tiers_by_step: Partial<Record<PipelineStep, SkillModelTier>>;
  ceiling_warnings: string[];
  a5_live: boolean;
  a5_verdict: string;
  freeze_checks_fired: string[];
}

export interface PipelineProvenance {
  pipeline_produced: true;
  answer_refs: string[];
  questions: QuestionCounts;
  enforcement: PipelineConfig;
  a5_live: boolean;
  outcome: FinishOutcome;
  experts?: ProvenanceExperts;
  metrics?: SpecPipelineMetrics;
}

export function buildProvenance(
  config: PipelineConfig,
  a5Live: boolean,
  answerRefs: string[],
  questions: QuestionCounts,
  experts?: ProvenanceExperts,
  metrics?: SpecPipelineMetrics,
): PipelineProvenance {
  return {
    pipeline_produced: true,
    answer_refs: answerRefs,
    questions,
    enforcement: config,
    a5_live: a5Live,
    outcome: decideFinish(config, a5Live).outcome,
    ...(experts ? { experts } : {}),
    ...(metrics ? { metrics } : {}),
  };
}

export interface StagedFinish {
  outcome?: FinishOutcome;
  reason?: string;
  provenance: Partial<PipelineProvenance>;
}

export function frozenPipelineSection(finish: StagedFinish): SpecPipelineSection {
  const { provenance } = finish;
  const outcome = finish.outcome ?? provenance.outcome;
  const config = provenance.enforcement;
  return {
    produced: true,
    ...(outcome === undefined ? {} : { outcome }),
    ...(finish.reason === undefined ? {} : { reason: finish.reason }),
    ...(provenance.a5_live === undefined ? {} : { a5_live: provenance.a5_live }),
    ...(config === undefined
      ? {}
      : {
          enforcement: {
            clarification: config.clarification,
            final_review: config.final_review,
            token_ceiling: config.token_ceiling,
            experts_enabled: config.experts_enabled,
            adoption: config.adoption,
            standing_experts: config.standing_experts,
            standing_experts_dropped: config.standing_experts_dropped,
          },
        }),
  };
}
