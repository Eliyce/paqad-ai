import { describe, expect, it } from 'vitest';

import {
  aggregateBenchmark,
  analystFacts,
  iterationLoopVerdict,
  judgeS5Gate,
  renderAnalyst,
  stats,
  type RunRecord,
} from '@/authoring/eval/aggregate.js';

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    case: 'happy',
    arm: 'with_skill',
    tier: 'fast',
    run: 1,
    model: 'haiku',
    assertions: [
      { text: 'writes ledger JSON', passed: true },
      { text: 'names the supplier', passed: true },
    ],
    passed: 2,
    total: 2,
    tokens: 1000,
    duration_ms: 2000,
    cost_usd: 0.01,
    cache_hit_share: 0.8,
    max_tool_result_tokens: 100,
    truncated: false,
    ...overrides,
  };
}

const RUNS: RunRecord[] = [
  run({ run: 1 }),
  run({ run: 2 }),
  run({
    case: 'edge',
    run: 1,
    passed: 1,
    assertions: [
      { text: 'writes ledger JSON', passed: true },
      { text: 'names the supplier', passed: false },
    ],
  }),
  run({
    arm: 'without_skill',
    run: 1,
    passed: 1,
    tokens: 800,
    assertions: [
      { text: 'writes ledger JSON', passed: true },
      { text: 'names the supplier', passed: false },
    ],
  }),
  run({
    arm: 'without_skill',
    run: 2,
    passed: 1,
    tokens: 800,
    assertions: [
      { text: 'writes ledger JSON', passed: true },
      { text: 'names the supplier', passed: false },
    ],
  }),
  run({
    arm: 'without_skill',
    case: 'edge',
    run: 1,
    passed: 0,
    tokens: 800,
    assertions: [
      { text: 'writes ledger JSON', passed: true },
      { text: 'names the supplier', passed: false },
    ],
  }),
];

describe('aggregateBenchmark (port of aggregate_benchmark.py)', () => {
  it('summarises each configuration and the per-case delta', () => {
    const summary = aggregateBenchmark(RUNS, 'without_skill');
    expect(summary.configurations.map((entry) => [entry.arm, entry.tier, entry.runs])).toEqual([
      ['with_skill', 'fast', 3],
      ['without_skill', 'fast', 3],
    ]);
    expect(summary.pass_rate_with).toBeCloseTo(0.8333, 3);
    expect(summary.pass_rate_baseline).toBeCloseTo(0.3333, 3);
    expect(summary.delta_points).toBe(50);
    expect(summary.token_multiple).toBe(1.25);
    expect(summary.cases).toEqual([
      { case: 'edge', pass_rate_with: 0.5, pass_rate_baseline: 0, delta_points: 50 },
      { case: 'happy', pass_rate_with: 1, pass_rate_baseline: 0.5, delta_points: 50 },
    ]);
    expect(stats([1, 2, 3])).toEqual({ mean: 2, stddev: 1, min: 1, max: 3 });
  });

  it('marks tokens unavailable when any run has none', () => {
    const summary = aggregateBenchmark(
      RUNS.map((entry) => ({ ...entry, tokens: null })),
      'without_skill',
    );
    expect(summary.tokens_available).toBe(false);
    expect(summary.token_multiple).toBeNull();
  });
});

describe('the S5 gate', () => {
  const base = aggregateBenchmark(RUNS, 'without_skill');

  it('AC-53: a gain of 10 passes and 9 fails; a multiple of 2.0 passes', () => {
    const judge = (delta: number, multiple: number) =>
      judgeS5Gate({
        summary: { ...base, delta_points: delta, token_multiple: multiple },
        adapter: 'subagent-dispatch',
        minGainPoints: 10,
        maxTokenMultiple: 2,
      }).passed;
    expect(judge(10, 2)).toBe(true);
    expect(judge(9, 1)).toBe(false);
    expect(judge(10, 2.01)).toBe(false);
  });

  it('AC-50: with tokens unavailable it lists the token checks as not measured and judges on gain alone', () => {
    const result = judgeS5Gate({
      summary: { ...base, tokens_available: false, token_multiple: null, delta_points: 0 },
      adapter: 'claude-plugin-eval',
      minGainPoints: 10,
      maxTokenMultiple: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.checks_not_measured).toEqual([
      { check: 'token-multiple', reason: 'tokens: unavailable on claude-plugin-eval' },
      { check: 'cache-hit', reason: 'tokens: unavailable on claude-plugin-eval' },
    ]);
  });

  it('improve mode passes without a gain and fails past the regression tolerance', () => {
    const judge = (delta: number, multiple = 1) =>
      judgeS5Gate({
        summary: { ...base, delta_points: delta, token_multiple: multiple },
        adapter: 'subagent-dispatch',
        minGainPoints: 10,
        maxTokenMultiple: 2,
        improve: { regressionTolerance: 0.2 },
      });
    expect(judge(0).passed).toBe(true);
    expect(judge(5.56).passed).toBe(true);
    expect(judge(-20).passed).toBe(true);
    expect(judge(-20.01).passed).toBe(false);
    expect(judge(-20.01).reasons).toEqual([
      'the pass rate fell 20.01 points below the old version; an edit may fall at most 20',
    ]);
    expect(judge(0, 2.01).passed).toBe(false);
  });

  it('a new skill still needs the gain when no improve tolerance is given', () => {
    const result = judgeS5Gate({
      summary: { ...base, delta_points: 5.56, token_multiple: 1 },
      adapter: 'subagent-dispatch',
      minGainPoints: 10,
      maxTokenMultiple: 2,
      improve: null,
    });
    expect(result.passed).toBe(false);
  });

  it('EC-02: a subjective skill passes only when the comparator prefers the new version on every case', () => {
    const judge = (preferred: Array<'new' | 'old' | 'tie'>) =>
      judgeS5Gate({
        summary: base,
        adapter: 'x',
        minGainPoints: 10,
        maxTokenMultiple: 2,
        subjective: { preferred },
      }).passed;
    expect(judge(['new', 'new'])).toBe(true);
    expect(judge(['new', 'tie'])).toBe(false);
  });
});

describe('analyst notes', () => {
  it('AC-7: names an assertion that passes in both arms on every run', () => {
    const facts = analystFacts({
      runs: RUNS,
      baselineArm: 'without_skill',
      toolResultMaxTokens: 50,
      cacheHitMin: 0.9,
    });
    expect(facts.always_pass).toEqual(['writes ledger JSON']);
    expect(facts.oversize_tool_results).toHaveLength(RUNS.length);
    expect(facts.cache_hit_share).toBe(0.8);
    expect(facts.cache_hit_below_min).toBe(true);
    const markdown = renderAnalyst(facts, null);
    expect(markdown).toContain('- writes ledger JSON');
    expect(markdown).not.toContain(String.fromCodePoint(0x2014));
  });

  it('EC-08: flags truncated and unverifiable runs, and cost outliers', () => {
    const facts = analystFacts({
      runs: [
        run({ truncated: true }),
        run({ run: 2, cost_usd: 1 }),
        run({ run: 3, assertions: [{ text: 'x', passed: null }] }),
      ],
      baselineArm: 'without_skill',
      toolResultMaxTokens: 10_000,
      cacheHitMin: 0.7,
    });
    expect(facts.unverifiable).toEqual([
      'happy / with_skill / fast / run-1',
      'happy / with_skill / fast / run-3',
    ]);
    expect(facts.cost_outliers).toEqual(['happy / with_skill / fast / run-2']);
  });
});

describe('the revision loop', () => {
  it('passes as soon as an iteration passes', async () => {
    expect(
      await iterationLoopVerdict([{ iteration: 1, passed: true, pass_rate_with: 0.9 }], 3),
    ).toMatchObject({ status: 'passed' });
  });

  it('continues while iterations remain and improve', async () => {
    expect(
      await iterationLoopVerdict([{ iteration: 1, passed: false, pass_rate_with: 0.4 }], 5),
    ).toMatchObject({ status: 'continue' });
  });

  it('AC-19: stops with a logged reason after 2 iterations without improvement', async () => {
    const verdict = await iterationLoopVerdict(
      [
        { iteration: 1, passed: false, pass_rate_with: 0.5 },
        { iteration: 2, passed: false, pass_rate_with: 0.5 },
        { iteration: 3, passed: false, pass_rate_with: 0.4 },
      ],
      5,
    );
    expect(verdict).toEqual({
      status: 'stopped',
      reason: '2 iterations in a row showed no improvement',
    });
  });

  it('stops at authoring_max_iterations and on empty feedback', async () => {
    const rising = [0.1, 0.2, 0.3].map((rate, index) => ({
      iteration: index + 1,
      passed: false,
      pass_rate_with: rate,
    }));
    expect((await iterationLoopVerdict(rising, 3)).reason).toBe(
      'the iteration cap of 3 was reached',
    );
    expect((await iterationLoopVerdict(rising.slice(0, 1), 3, true)).reason).toBe(
      'the feedback was empty',
    );
  });
});
