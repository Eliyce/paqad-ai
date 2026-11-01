import { meetsThreshold, withinLimit } from '../thresholds.js';

export const PASS_K = 3;
export const P95_MIN_SAMPLES = 10;

export interface TrialOutcome {
  case: string;
  arm: string;
  tier: string;
  passed: boolean;
}

export interface CaseReliability {
  case: string;
  trials: number;
  passed: number;
  pass_hat_k: number;
  pass_at_k: number;
}

export interface Reliability {
  arm: string;
  tier: string;
  k: number;
  pass_hat_k: number;
  pass_at_k: number;
  cases: CaseReliability[];
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return result;
}

export function passHatK(trials: number, passed: number, k: number = PASS_K): number {
  const total = combinations(trials, k);
  return total === 0 ? 0 : combinations(passed, k) / total;
}

export function passAtK(trials: number, passed: number, k: number = PASS_K): number {
  const total = combinations(trials, k);
  return total === 0 ? 0 : 1 - combinations(trials - passed, k) / total;
}

export function trialPassed(input: { passed: number; total: number; cut_off?: boolean }): boolean {
  return input.total > 0 && input.passed === input.total && input.cut_off !== true;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function reliabilityOf(
  outcomes: readonly TrialOutcome[],
  arm: string,
  tier: string,
  k: number = PASS_K,
): Reliability {
  const members = outcomes.filter((entry) => entry.arm === arm && entry.tier === tier);
  const names = [...new Set(members.map((entry) => entry.case))].sort(compareText);
  const cases = names.map((name): CaseReliability => {
    const trials = members.filter((entry) => entry.case === name);
    const passed = trials.filter((entry) => entry.passed).length;
    return {
      case: name,
      trials: trials.length,
      passed,
      pass_hat_k: round(passHatK(trials.length, passed, k)),
      pass_at_k: round(passAtK(trials.length, passed, k)),
    };
  });
  const mean = (values: readonly number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    arm,
    tier,
    k,
    pass_hat_k: round(mean(cases.map((entry) => entry.pass_hat_k))),
    pass_at_k: round(mean(cases.map((entry) => entry.pass_at_k))),
    cases,
  };
}

export function reliabilityTable(
  outcomes: readonly TrialOutcome[],
  k: number = PASS_K,
): Reliability[] {
  const keys = [...new Set(outcomes.map((entry) => `${entry.arm}|${entry.tier}`))].sort(
    compareText,
  );
  return keys.map((key) => {
    const [arm, tier] = key.split('|') as [string, string];
    return reliabilityOf(outcomes, arm, tier, k);
  });
}

export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(share * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

export function latencyMeasure(values: readonly number[]): {
  value: number;
  measure: 'p95' | 'median';
  samples: number;
} {
  const samples = values.length;
  if (samples < P95_MIN_SAMPLES) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const value =
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 1
          ? sorted[middle]!
          : (sorted[middle - 1]! + sorted[middle]!) / 2;
    return { value, measure: 'median', samples };
  }
  return { value: percentile(values, 0.95), measure: 'p95', samples };
}

export interface AgentArmMetrics {
  pass_hat_k: number;
  pass_rate?: number;
  tokens_median: number | null;
  cost_median: number | null;
  latency_ms: number | null;
}

export interface AgentS5GateInput {
  agent: AgentArmMetrics;
  baseline: AgentArmMetrics;
  passKThreshold: number;
  minGainPoints: number;
  maxCostMultiple: number;
  parallelWallTimeGain?: boolean;
  edited?: { previous: AgentArmMetrics; tolerance: number; passKDropAllowed?: number } | null;
  subjective?: { preferred: Array<'new' | 'old' | 'tie'> } | null;
}

export interface AgentS5GateResult {
  passed: boolean;
  no_gain: boolean;
  reasons: string[];
  checks_not_measured: Array<{ check: string; reason: string }>;
}

function points(value: number): number {
  return Math.round(value * 10000) / 100;
}

function regressionReasons(
  current: AgentArmMetrics,
  previous: AgentArmMetrics,
  tolerance: number,
  notMeasured: AgentS5GateResult['checks_not_measured'],
): string[] {
  const reasons: string[] = [];
  const checks: Array<[string, number | null, number | null]> = [
    ['tokens per task', current.tokens_median, previous.tokens_median],
    ['cost', current.cost_median, previous.cost_median],
    ['p95 latency (ms)', current.latency_ms, previous.latency_ms],
  ];
  for (const [label, now, before] of checks) {
    if (now === null || before === null) {
      notMeasured.push({ check: label, reason: 'unavailable on this host' });
      continue;
    }
    const limit = before * (1 + tolerance);
    if (!withinLimit(now, limit)) {
      const rise = before === 0 ? Infinity : Math.round(((now - before) / before) * 10000) / 100;
      reasons.push(
        `${label} rose to ${now} from ${before} (${rise}%), beyond the ${points(tolerance)}% tolerance`,
      );
    }
  }
  return reasons;
}

export function judgeAgentS5Gate(input: AgentS5GateInput): AgentS5GateResult {
  const reasons: string[] = [];
  const notMeasured: AgentS5GateResult['checks_not_measured'] = [];
  let noGain = false;
  if (!meetsThreshold(input.agent.pass_hat_k, input.passKThreshold)) {
    reasons.push(`pass^${PASS_K} is ${input.agent.pass_hat_k}; it needs ${input.passKThreshold}`);
  }
  if (input.edited) {
    const previous = input.edited.previous;
    const allowed = input.edited.passKDropAllowed ?? input.edited.tolerance;
    const floor = previous.pass_hat_k * (1 - allowed);
    if (!meetsThreshold(input.agent.pass_hat_k, floor)) {
      reasons.push(
        `pass^${PASS_K} fell to ${input.agent.pass_hat_k} from ${previous.pass_hat_k}, beyond the ${points(allowed)}% tolerance`,
      );
    }
    reasons.push(...regressionReasons(input.agent, previous, input.edited.tolerance, notMeasured));
  } else {
    const gain = points(input.agent.pass_hat_k - input.baseline.pass_hat_k);
    if (!meetsThreshold(gain, input.minGainPoints)) {
      noGain = true;
      reasons.push(
        `no gain: pass^${PASS_K} beat the baseline by ${gain} points (${input.agent.pass_hat_k} against ${input.baseline.pass_hat_k}); it needs ${input.minGainPoints}`,
      );
    }
  }
  if (input.agent.cost_median === null || input.baseline.cost_median === null) {
    notMeasured.push({ check: 'cost multiple', reason: 'cost unavailable on this host' });
  } else if (input.baseline.cost_median > 0 && input.parallelWallTimeGain !== true) {
    const multiple =
      Math.round((input.agent.cost_median / input.baseline.cost_median) * 1000) / 1000;
    if (!withinLimit(multiple, input.maxCostMultiple)) {
      reasons.push(
        `median cost is ${multiple}x the baseline; the limit is ${input.maxCostMultiple}x unless a parallel wall-time gain is shown`,
      );
    }
  }
  if (input.subjective) {
    const all =
      input.subjective.preferred.length > 0 &&
      input.subjective.preferred.every((choice) => choice === 'new');
    if (!all) reasons.push('the blind comparator did not prefer the new version on every case');
  }
  return {
    passed: reasons.length === 0,
    no_gain: noGain,
    reasons,
    checks_not_measured: notMeasured,
  };
}

export function cheapestPassingTier<T extends string>(
  results: ReadonlyArray<{ tier: T; passed: boolean }>,
  order: readonly T[],
): T | null {
  for (const tier of order) {
    if (results.some((entry) => entry.tier === tier && entry.passed)) return tier;
  }
  return null;
}

export interface MemoryDecision {
  kept: boolean;
  with_agent_pass_k: number;
  with_agent_memory_pass_k: number;
  with_agent_tokens_median: number | null;
  with_agent_memory_tokens_median: number | null;
  reason: string;
}

export function memoryDecision(input: {
  withAgent: AgentArmMetrics;
  withMemory: AgentArmMetrics;
  tokenTolerance: number;
}): MemoryDecision {
  const base = {
    with_agent_pass_k: input.withAgent.pass_hat_k,
    with_agent_memory_pass_k: input.withMemory.pass_hat_k,
    with_agent_tokens_median: input.withAgent.tokens_median,
    with_agent_memory_tokens_median: input.withMemory.tokens_median,
  };
  if (!(input.withMemory.pass_hat_k > input.withAgent.pass_hat_k)) {
    return { ...base, kept: false, reason: 'memory did not raise pass^3' };
  }
  const tokens = input.withMemory.tokens_median;
  const budget =
    input.withAgent.tokens_median === null
      ? null
      : input.withAgent.tokens_median * (1 + input.tokenTolerance);
  if (tokens !== null && budget !== null && !withinLimit(tokens, budget)) {
    return {
      ...base,
      kept: false,
      reason: `memory raised median tokens to ${tokens}, over ${budget}`,
    };
  }
  return { ...base, kept: true, reason: 'memory raised pass^3 within the token budget' };
}
