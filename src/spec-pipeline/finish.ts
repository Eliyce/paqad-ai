// S5 finish — freeze, non-blocking review, or await-human (issue #512, FR-7).
//
// The finishing decision is deterministic and hard-gated on A5 (FR-7.1): an automatic,
// unattended freeze is permitted ONLY when the spec-vs-code check is live. When A5 is absent
// the pipeline NEVER freezes silently — it renders the readable spec as a non-blocking review
// (FR-7.2 / EC-13). Independently, the switchable final-review gate can require a named human
// to approve before freeze (FR-7.3). Provenance is honest: it records that the spec was
// pipeline-produced, the answer references (human input by reference), the question counts,
// the enforcement config in effect, and whether A5 was live — and NEVER claims a human
// approved something they did not (FR-7.4).

import type { PipelineConfig } from './config.js';

export type FinishOutcome = 'freeze' | 'non-blocking-review' | 'await-human-approval';

export interface FinishDecision {
  outcome: FinishOutcome;
  reason: string;
}

/**
 * Decide how a run finishes, purely from the A5-live flag and the final-review gate.
 * - final_review = strict  ⇒ await a named human's approval before freeze (FR-7.3).
 * - A5 not live            ⇒ non-blocking readable review, never a silent freeze (FR-7.2).
 * - otherwise (A5 live)    ⇒ automatic freeze (FR-7.1); final_review = warn shows then freezes.
 */
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

/** Question counts recorded for provenance/metrics (FR-7.6). */
export interface QuestionCounts {
  asked: number;
  answered: number;
  auto_answered: number;
  deferred: number;
}

/** The honest provenance record folded into the finish artifact (FR-7.4). Never a signature. */
export interface PipelineProvenance {
  pipeline_produced: true;
  /** Human input carried by REFERENCE only (ledgered answer ids), never a fabricated sign-off. */
  answer_refs: string[];
  questions: QuestionCounts;
  enforcement: PipelineConfig;
  a5_live: boolean;
  outcome: FinishOutcome;
}

export function buildProvenance(
  config: PipelineConfig,
  a5Live: boolean,
  answerRefs: string[],
  questions: QuestionCounts,
): PipelineProvenance {
  return {
    pipeline_produced: true,
    answer_refs: answerRefs,
    questions,
    enforcement: config,
    a5_live: a5Live,
    outcome: decideFinish(config, a5Live).outcome,
  };
}
