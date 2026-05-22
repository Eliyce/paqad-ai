import { DEFAULT_BENCHMARK_GATES } from '@/core/project-intelligence.js';
import { compareConfigurations, evaluateBenchmarkGates } from '@/rag/benchmark-gates.js';
import type { ComparisonMode } from '@/rag/types.js';

describe('RAG benchmark gates', () => {
  it('passes the default benchmark gates for an improved hybrid retrieval run', () => {
    const report = evaluateBenchmarkGates(
      {
        hit_at_5: 0.5,
        task_success_rate: 0.4,
        correction_turns: 2,
        prompt_tokens_sent: 8000,
        task_count: 32,
      },
      {
        hit_at_5: 0.68,
        task_success_rate: 0.46,
        correction_turns: 1.5,
        prompt_tokens_sent: 8600,
        task_count: 32,
      },
    );

    expect(report.passed).toBe(true);
    expect(report.metrics.hit_at_5.passed).toBe(true);
    expect(report.metrics.task_success_rate.passed).toBe(true);
    expect(report.metrics.correction_turns.passed).toBe(true);
    expect(report.metrics.prompt_tokens_sent.passed).toBe(true);
  });

  it('fails when the benchmark deltas do not meet the configured gates', () => {
    const report = evaluateBenchmarkGates(
      {
        hit_at_5: 0.5,
        task_success_rate: 0.4,
        correction_turns: 2,
        prompt_tokens_sent: 8000,
        task_count: 32,
      },
      {
        hit_at_5: 0.54,
        task_success_rate: 0.41,
        correction_turns: 2.1,
        prompt_tokens_sent: 9200,
        task_count: 32,
      },
    );

    expect(report.passed).toBe(false);
    expect(report.metrics.hit_at_5.passed).toBe(false);
    expect(report.metrics.task_success_rate.passed).toBe(false);
    expect(report.metrics.correction_turns.passed).toBe(false);
    expect(report.metrics.prompt_tokens_sent.passed).toBe(false);
  });

  it('allows prompt token increases when success improvement exceeds the override gate', () => {
    const report = evaluateBenchmarkGates(
      {
        hit_at_5: 0.5,
        task_success_rate: 0.4,
        correction_turns: 2,
        prompt_tokens_sent: 8000,
        task_count: 32,
      },
      {
        hit_at_5: 0.7,
        task_success_rate: 0.5,
        correction_turns: 1.4,
        prompt_tokens_sent: 10000,
        task_count: 32,
      },
      DEFAULT_BENCHMARK_GATES,
    );

    expect(report.metrics.prompt_tokens_sent.override_passed).toBe(true);
    expect(report.metrics.prompt_tokens_sent.passed).toBe(true);
    expect(report.metrics.prompt_tokens_sent.summary).toContain('success override passed');
  });

  it('treats zero-baseline prompt token runs as override-only comparisons', () => {
    const report = evaluateBenchmarkGates(
      {
        hit_at_5: 0.1,
        task_success_rate: 0.1,
        correction_turns: 2,
        prompt_tokens_sent: 0,
        task_count: 32,
      },
      {
        hit_at_5: 0.5,
        task_success_rate: 0.5,
        correction_turns: 1,
        prompt_tokens_sent: 120,
        task_count: 32,
      },
      DEFAULT_BENCHMARK_GATES,
    );

    expect(report.metrics.prompt_tokens_sent.baseline_zero).toBe(true);
    expect(report.metrics.prompt_tokens_sent.override_passed).toBe(true);
    expect(report.metrics.prompt_tokens_sent.summary).toContain('baseline=0');
  });

  it('fails zero-baseline prompt token comparisons when the success override is not met', () => {
    const report = evaluateBenchmarkGates(
      {
        hit_at_5: 0.1,
        task_success_rate: 0.1,
        correction_turns: 2,
        prompt_tokens_sent: 0,
        task_count: 32,
      },
      {
        hit_at_5: 0.2,
        task_success_rate: 0.11,
        correction_turns: 1.8,
        prompt_tokens_sent: 120,
        task_count: 32,
      },
      DEFAULT_BENCHMARK_GATES,
    );

    expect(report.metrics.prompt_tokens_sent.baseline_zero).toBe(true);
    expect(report.metrics.prompt_tokens_sent.override_passed).toBe(false);
    expect(report.metrics.prompt_tokens_sent.passed).toBe(false);
    expect(report.metrics.prompt_tokens_sent.summary).toContain('cannot satisfy');
  });
});

describe('RagBenchmarkSnapshot action_quality fields', () => {
  it('accepts a snapshot with action quality metadata', () => {
    const snapshot = {
      hit_at_5: 0.6,
      task_success_rate: 0.5,
      correction_turns: 1,
      prompt_tokens_sent: 9000,
      task_count: 20,
      action_quality: {
        workflow_correctness_pct: 85,
        evidence_grounding_pct: 90,
        noisy_suggestion_rate: 0.05,
      },
    };
    expect(snapshot.action_quality?.workflow_correctness_pct).toBe(85);
    expect(snapshot.action_quality?.evidence_grounding_pct).toBe(90);
    expect(snapshot.action_quality?.noisy_suggestion_rate).toBe(0.05);
  });

  it('accepts a snapshot without action quality metadata', () => {
    const snapshot = {
      hit_at_5: 0.6,
      task_success_rate: 0.5,
      correction_turns: 1,
      prompt_tokens_sent: 9000,
      task_count: 20,
    };
    expect(snapshot.action_quality).toBeUndefined();
  });
});

describe('RagBenchmarkSnapshot reranking fields', () => {
  it('accepts a snapshot with reranking metadata', () => {
    const snapshot = {
      hit_at_5: 0.6,
      task_success_rate: 0.5,
      correction_turns: 1,
      prompt_tokens_sent: 9000,
      task_count: 20,
      reranking: {
        enabled: true,
        backend: 'local',
        candidate_pool_size: 50,
        packed_size: 8,
        latency_ms: 42,
      },
    };
    expect(snapshot.reranking?.enabled).toBe(true);
    expect(snapshot.reranking?.backend).toBe('local');
    expect(snapshot.reranking?.candidate_pool_size).toBe(50);
    expect(snapshot.reranking?.packed_size).toBe(8);
  });

  it('accepts a snapshot without reranking metadata', () => {
    const snapshot = {
      hit_at_5: 0.6,
      task_success_rate: 0.5,
      correction_turns: 1,
      prompt_tokens_sent: 9000,
      task_count: 20,
    };
    expect(snapshot.reranking).toBeUndefined();
  });
});

describe('compareConfigurations', () => {
  const baseline = {
    hit_at_5: 0.5,
    task_success_rate: 0.4,
    correction_turns: 2,
    prompt_tokens_sent: 8000,
    task_count: 32,
  };
  const candidate = {
    hit_at_5: 0.68,
    task_success_rate: 0.46,
    correction_turns: 1.5,
    prompt_tokens_sent: 8600,
    task_count: 32,
  };

  it.each(['lexical-vs-rag', 'rag-vs-candidate', 'feature-off-vs-on'] as ComparisonMode[])(
    'returns the mode "%s" in the result',
    (mode) => {
      const result = compareConfigurations(baseline, candidate, mode);
      expect(result.mode).toBe(mode);
    },
  );

  it('wraps evaluateBenchmarkGates correctly', () => {
    const result = compareConfigurations(baseline, candidate, 'rag-vs-candidate');
    const direct = evaluateBenchmarkGates(baseline, candidate);
    expect(result.evaluation.passed).toBe(direct.passed);
    expect(result.evaluation.metrics.hit_at_5).toEqual(direct.metrics.hit_at_5);
  });

  it('forwards custom gates to evaluateBenchmarkGates', () => {
    const strictGates = { ...DEFAULT_BENCHMARK_GATES, hit_at_5_improvement_pct: 99 };
    const result = compareConfigurations(baseline, candidate, 'feature-off-vs-on', strictGates);
    expect(result.evaluation.metrics.hit_at_5.passed).toBe(false);
    expect(result.evaluation.gates).toEqual(strictGates);
  });
});
