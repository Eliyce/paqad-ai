import { runBuildCheckFixLoop } from '@/loop/build-check-fix-loop.js';

import { meetsThreshold, withinLimit } from '../thresholds.js';

export type EvalArm = 'with_skill' | 'without_skill' | 'old_skill';

export interface AssertionResult {
  text: string;
  passed: boolean | null;
}

export interface RunRecord {
  case: string;
  arm: EvalArm;
  tier: string;
  run: number;
  model: string;
  assertions: AssertionResult[];
  passed: number;
  total: number;
  tokens: number | null;
  duration_ms: number;
  cost_usd: number | null;
  cache_hit_share: number | null;
  max_tool_result_tokens: number | null;
  truncated: boolean;
}

export interface Stats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

export interface ConfigurationSummary {
  arm: EvalArm;
  tier: string;
  runs: number;
  pass_rate: Stats;
  time_seconds: Stats;
  tokens: { mean: number; median: number } | null;
}

export interface CaseDelta {
  case: string;
  pass_rate_with: number;
  pass_rate_baseline: number;
  delta_points: number;
}

export interface BenchmarkSummary {
  baseline_arm: EvalArm;
  configurations: ConfigurationSummary[];
  cases: CaseDelta[];
  pass_rate_with: number;
  pass_rate_baseline: number;
  delta_points: number;
  token_multiple: number | null;
  models: string[];
  tokens_available: boolean;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function stats(values: readonly number[]): Stats {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return {
    mean: round(mean),
    stddev: round(Math.sqrt(variance)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function runPassRate(run: RunRecord): number {
  return run.total === 0 ? 0 : run.passed / run.total;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pooledRate(runs: readonly RunRecord[]): number {
  return runs.length === 0 ? 0 : stats(runs.map(runPassRate)).mean;
}

export function aggregateBenchmark(
  runs: readonly RunRecord[],
  baselineArm: EvalArm,
): BenchmarkSummary {
  const keys = [...new Set(runs.map((run) => `${run.arm}|${run.tier}`))].sort(compareText);
  const tokensAvailable = runs.length > 0 && runs.every((run) => run.tokens !== null);
  const configurations = keys.map((key): ConfigurationSummary => {
    const [arm, tier] = key.split('|') as [EvalArm, string];
    const members = runs.filter((run) => run.arm === arm && run.tier === tier);
    const tokens = members
      .map((run) => run.tokens)
      .filter((value): value is number => value !== null);
    return {
      arm,
      tier,
      runs: members.length,
      pass_rate: stats(members.map(runPassRate)),
      time_seconds: stats(members.map((run) => run.duration_ms / 1000)),
      tokens:
        tokens.length === members.length && tokens.length > 0
          ? { mean: round(stats(tokens).mean, 1), median: median(tokens) }
          : null,
    };
  });
  const withRuns = runs.filter((run) => run.arm === 'with_skill');
  const baseRuns = runs.filter((run) => run.arm === baselineArm);
  const cases = [...new Set(runs.map((run) => run.case))].sort(compareText).map((name) => {
    const withRate = pooledRate(withRuns.filter((run) => run.case === name));
    const baseRate = pooledRate(baseRuns.filter((run) => run.case === name));
    return {
      case: name,
      pass_rate_with: withRate,
      pass_rate_baseline: baseRate,
      delta_points: round((withRate - baseRate) * 100, 2),
    };
  });
  const withRate = pooledRate(withRuns);
  const baseRate = pooledRate(baseRuns);
  const baseTokens = median(baseRuns.map((run) => run.tokens ?? 0));
  return {
    baseline_arm: baselineArm,
    configurations,
    cases,
    pass_rate_with: withRate,
    pass_rate_baseline: baseRate,
    delta_points: round((withRate - baseRate) * 100, 2),
    token_multiple:
      tokensAvailable && baseTokens > 0
        ? round(median(withRuns.map((run) => run.tokens ?? 0)) / baseTokens, 3)
        : null,
    models: [...new Set(runs.map((run) => run.model))].sort(compareText),
    tokens_available: tokensAvailable,
  };
}

export interface S5GateInput {
  summary: BenchmarkSummary;
  adapter: string;
  minGainPoints: number;
  maxTokenMultiple: number;
  improve?: { regressionTolerance: number } | null;
  subjective?: { preferred: Array<'new' | 'old' | 'tie'> } | null;
}

export interface S5GateResult {
  passed: boolean;
  reasons: string[];
  checks_not_measured: Array<{ check: string; reason: string }>;
}

export function judgeS5Gate(input: S5GateInput): S5GateResult {
  const reasons: string[] = [];
  const notMeasured: S5GateResult['checks_not_measured'] = [];
  if (input.subjective) {
    const all =
      input.subjective.preferred.length > 0 &&
      input.subjective.preferred.every((choice) => choice === 'new');
    if (!all) reasons.push('the blind comparator did not prefer the new version on every case');
  } else if (input.improve) {
    const floor = -Math.round(input.improve.regressionTolerance * 10000) / 100;
    if (!meetsThreshold(input.summary.delta_points, floor)) {
      reasons.push(
        `the pass rate fell ${-input.summary.delta_points} points below the old version; an edit may fall at most ${-floor}`,
      );
    }
  } else if (!meetsThreshold(input.summary.delta_points, input.minGainPoints)) {
    reasons.push(
      `the pass rate gained ${input.summary.delta_points} points over the baseline; it needs ${input.minGainPoints}`,
    );
  }
  if (!input.summary.tokens_available || input.summary.token_multiple === null) {
    const reason = `tokens: unavailable on ${input.adapter}`;
    notMeasured.push({ check: 'token-multiple', reason }, { check: 'cache-hit', reason });
  } else if (!withinLimit(input.summary.token_multiple, input.maxTokenMultiple)) {
    reasons.push(
      `median tokens are ${input.summary.token_multiple}x the baseline; the limit is ${input.maxTokenMultiple}x`,
    );
  }
  return { passed: reasons.length === 0, reasons, checks_not_measured: notMeasured };
}

export interface AnalystInput {
  runs: readonly RunRecord[];
  baselineArm: EvalArm;
  toolResultMaxTokens: number;
  cacheHitMin: number;
}

export interface AnalystFacts {
  always_pass: string[];
  always_fail: string[];
  high_variance: string[];
  cost_outliers: string[];
  oversize_tool_results: string[];
  unverifiable: string[];
  cache_hit_share: number | null;
  cache_hit_below_min: boolean;
}

const HIGH_VARIANCE_STDDEV = 0.3;
const COST_OUTLIER_MULTIPLE = 2;

export function analystFacts(input: AnalystInput): AnalystFacts {
  const relevant = input.runs.filter(
    (run) => run.arm === 'with_skill' || run.arm === input.baselineArm,
  );
  const outcomes = new Map<string, boolean[]>();
  for (const run of relevant) {
    for (const assertion of run.assertions) {
      if (assertion.passed === null) continue;
      outcomes.set(assertion.text, [...(outcomes.get(assertion.text) ?? []), assertion.passed]);
    }
  }
  const names = [...outcomes.keys()].sort(compareText);
  const highVariance = [...new Set(input.runs.map((run) => `${run.case}|${run.arm}|${run.tier}`))]
    .sort(compareText)
    .filter((key) => {
      const [name, arm, tier] = key.split('|');
      const rates = input.runs
        .filter((run) => run.case === name && run.arm === arm && run.tier === tier)
        .map(runPassRate);
      return stats(rates).stddev > HIGH_VARIANCE_STDDEV;
    })
    .map((key) => key.replaceAll('|', ' / '));
  const costs = input.runs
    .map((run) => run.cost_usd)
    .filter((cost): cost is number => cost !== null);
  const costMedian = median(costs);
  const label = (run: RunRecord) => `${run.case} / ${run.arm} / ${run.tier} / run-${run.run}`;
  const cacheShares = input.runs
    .map((run) => run.cache_hit_share)
    .filter((share): share is number => share !== null);
  const cacheShare = cacheShares.length === 0 ? null : round(stats(cacheShares).mean);
  return {
    always_pass: names.filter((name) => outcomes.get(name)!.every(Boolean)),
    always_fail: names.filter((name) => outcomes.get(name)!.every((passed) => !passed)),
    high_variance: highVariance,
    cost_outliers:
      costMedian > 0
        ? input.runs
            .filter(
              (run) => run.cost_usd !== null && run.cost_usd > costMedian * COST_OUTLIER_MULTIPLE,
            )
            .map(label)
        : [],
    oversize_tool_results: input.runs
      .filter(
        (run) =>
          run.max_tool_result_tokens !== null &&
          run.max_tool_result_tokens > input.toolResultMaxTokens,
      )
      .map(label),
    unverifiable: input.runs
      .filter(
        (run) => run.truncated || run.assertions.some((assertion) => assertion.passed === null),
      )
      .map(label),
    cache_hit_share: cacheShare,
    cache_hit_below_min: cacheShare !== null && !meetsThreshold(cacheShare, input.cacheHitMin),
  };
}

function list(items: readonly string[]): string {
  return items.length === 0 ? 'None.' : items.map((item) => `- ${item}`).join('\n');
}

export function renderAnalyst(facts: AnalystFacts, tokensNote: string | null): string {
  return [
    '# Analyst notes',
    '',
    '## Assertions that pass in both arms on every run',
    '',
    list(facts.always_pass),
    '',
    '## Assertions that fail in both arms on every run',
    '',
    list(facts.always_fail),
    '',
    '## High-variance cases',
    '',
    list(facts.high_variance),
    '',
    '## Cost outliers',
    '',
    list(facts.cost_outliers),
    '',
    '## Oversize tool results',
    '',
    list(facts.oversize_tool_results),
    '',
    '## Truncated or unverifiable runs',
    '',
    list(facts.unverifiable),
    '',
    '## Cache-hit share',
    '',
    facts.cache_hit_share === null
      ? (tokensNote ?? 'Not measured.')
      : `${facts.cache_hit_share}${facts.cache_hit_below_min ? ' (below the steady-state minimum)' : ''}`,
    '',
  ].join('\n');
}

export interface IterationOutcome {
  iteration: number;
  passed: boolean;
  pass_rate_with: number;
}

export type LoopVerdict =
  | { status: 'passed'; reason: string }
  | { status: 'continue'; reason: string }
  | { status: 'stopped'; reason: string };

class NotRecordedYet extends Error {}

export async function iterationLoopVerdict(
  iterations: readonly IterationOutcome[],
  maxIterations: number,
  feedbackEmpty = false,
): Promise<LoopVerdict> {
  let best = -1;
  const signatures = iterations.map((iteration) => {
    best = Math.max(best, iteration.pass_rate_with);
    return `best:${best}`;
  });
  try {
    const outcome = await runBuildCheckFixLoop({
      lane: 'full',
      max_rounds: maxIterations,
      futility_threshold: 3,
      now: () => '',
      runRound: async (round) => {
        const iteration = iterations[round - 1];
        if (!iteration) throw new NotRecordedYet();
        return {
          done_input: {
            gates_passed: iteration.passed,
            acceptance_criteria: [{ criterion_id: 's5-gate', proof_passing: iteration.passed }],
            findings: [],
          },
          blocking_gates: iteration.passed ? [] : [signatures[round - 1]!],
          evidence_excerpt: null,
        };
      },
    });
    if (outcome.status === 'done') return { status: 'passed', reason: 'the S5 gate passed' };
    if (outcome.status === 'stopped-futility') {
      return { status: 'stopped', reason: '2 iterations in a row showed no improvement' };
    }
    return { status: 'stopped', reason: `the iteration cap of ${maxIterations} was reached` };
  } catch (error) {
    if (!(error instanceof NotRecordedYet)) throw error;
    if (feedbackEmpty) return { status: 'stopped', reason: 'the feedback was empty' };
    return { status: 'continue', reason: 'revise the skill and run the next iteration' };
  }
}
