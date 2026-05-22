import { DEFAULT_BENCHMARK_GATES } from '@/core/project-intelligence.js';
import type { BenchmarkGateConfig } from '@/core/types/project-profile.js';
import type { ComparisonMode } from './types.js';

export interface RagBenchmarkSnapshot {
  hit_at_5: number;
  task_success_rate: number;
  correction_turns: number;
  prompt_tokens_sent: number;
  task_count: number;
  reranking?: {
    enabled: boolean;
    backend: string;
    candidate_pool_size: number;
    packed_size: number;
    latency_ms: number;
  };
  action_quality?: {
    workflow_correctness_pct: number;
    evidence_grounding_pct: number;
    noisy_suggestion_rate: number;
  };
}

export interface RagBenchmarkMetricResult {
  passed: boolean;
  delta_pct: number;
  threshold_pct: number;
  summary: string;
  baseline_zero?: boolean;
}

export interface RagPromptTokenGateResult extends RagBenchmarkMetricResult {
  override_passed: boolean;
  success_delta_pct: number;
}

export interface RagBenchmarkEvaluation {
  passed: boolean;
  baseline: RagBenchmarkSnapshot;
  candidate: RagBenchmarkSnapshot;
  gates: BenchmarkGateConfig;
  metrics: {
    hit_at_5: RagBenchmarkMetricResult;
    task_success_rate: RagBenchmarkMetricResult;
    correction_turns: RagBenchmarkMetricResult;
    prompt_tokens_sent: RagPromptTokenGateResult;
  };
}

export interface ConfigurationComparisonResult {
  mode: ComparisonMode;
  evaluation: RagBenchmarkEvaluation;
}

export function compareConfigurations(
  baseline: RagBenchmarkSnapshot,
  candidate: RagBenchmarkSnapshot,
  mode: ComparisonMode,
  gates?: BenchmarkGateConfig,
): ConfigurationComparisonResult {
  return {
    mode,
    evaluation: evaluateBenchmarkGates(baseline, candidate, gates),
  };
}

function relativeChangePct(baseline: number, candidate: number): number {
  if (baseline === 0) {
    if (candidate === 0) {
      return 0;
    }
    return Number.POSITIVE_INFINITY;
  }
  return ((candidate - baseline) / baseline) * 100;
}

function reductionPct(baseline: number, candidate: number): number {
  if (baseline === 0) {
    return candidate === 0 ? 0 : -100;
  }
  return ((baseline - candidate) / baseline) * 100;
}

function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) {
    return '+inf%';
  }
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}

export function evaluateBenchmarkGates(
  baseline: RagBenchmarkSnapshot,
  candidate: RagBenchmarkSnapshot,
  gates: BenchmarkGateConfig = DEFAULT_BENCHMARK_GATES,
): RagBenchmarkEvaluation {
  const hitDelta = relativeChangePct(baseline.hit_at_5, candidate.hit_at_5);
  const successDelta = relativeChangePct(baseline.task_success_rate, candidate.task_success_rate);
  const correctionDelta = reductionPct(baseline.correction_turns, candidate.correction_turns);
  const promptDelta = relativeChangePct(baseline.prompt_tokens_sent, candidate.prompt_tokens_sent);
  const promptBaselineZero = baseline.prompt_tokens_sent === 0 && candidate.prompt_tokens_sent > 0;

  const hitPass = hitDelta >= gates.hit_at_5_improvement_pct;
  const successPass = successDelta >= gates.task_success_rate_improvement_pct;
  const correctionPass = correctionDelta >= gates.correction_turn_reduction_pct;
  const promptOverridePass = successDelta >= gates.prompt_token_override_success_improvement_pct;
  const promptPass = promptDelta <= gates.prompt_token_increase_limit_pct || promptOverridePass;

  return {
    passed: hitPass && successPass && correctionPass && promptPass,
    baseline,
    candidate,
    gates,
    metrics: {
      hit_at_5: {
        passed: hitPass,
        delta_pct: hitDelta,
        threshold_pct: gates.hit_at_5_improvement_pct,
        summary: `${hitPass ? 'PASS' : 'FAIL'} hit@5 ${formatDelta(hitDelta)} vs required +${gates.hit_at_5_improvement_pct}%`,
      },
      task_success_rate: {
        passed: successPass,
        delta_pct: successDelta,
        threshold_pct: gates.task_success_rate_improvement_pct,
        summary: `${successPass ? 'PASS' : 'FAIL'} task success ${formatDelta(successDelta)} vs required +${gates.task_success_rate_improvement_pct}%`,
      },
      correction_turns: {
        passed: correctionPass,
        delta_pct: correctionDelta,
        threshold_pct: gates.correction_turn_reduction_pct,
        summary: `${correctionPass ? 'PASS' : 'FAIL'} correction turns ${formatDelta(correctionDelta)} vs required +${gates.correction_turn_reduction_pct}% reduction`,
      },
      prompt_tokens_sent: {
        passed: promptPass,
        delta_pct: promptDelta,
        threshold_pct: gates.prompt_token_increase_limit_pct,
        baseline_zero: promptBaselineZero,
        override_passed: promptOverridePass,
        success_delta_pct: successDelta,
        summary: promptBaselineZero
          ? promptPass
            ? `PASS prompt tokens baseline=0 candidate=${candidate.prompt_tokens_sent} via success override`
            : `FAIL prompt tokens baseline=0 candidate=${candidate.prompt_tokens_sent} cannot satisfy +${gates.prompt_token_increase_limit_pct}% limit without success override`
          : promptPass
            ? promptOverridePass && promptDelta > gates.prompt_token_increase_limit_pct
              ? `PASS prompt tokens ${formatDelta(promptDelta)} exceeded +${gates.prompt_token_increase_limit_pct}% but success override passed (${formatDelta(successDelta)})`
              : `PASS prompt tokens ${formatDelta(promptDelta)} with limit +${gates.prompt_token_increase_limit_pct}%`
            : `FAIL prompt tokens ${formatDelta(promptDelta)} exceeded +${gates.prompt_token_increase_limit_pct}% without success override`,
      },
    },
  };
}
