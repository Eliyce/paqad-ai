import { descriptionLength, descriptionWithinLimit } from '../lint/fields.js';
import { meetsThreshold } from '../thresholds.js';
import { estimateTokens } from '../tokens.js';

export const TRIGGER_SEED = 42;
export const TRAIN_SHARE = 0.6;
export const TRIGGER_RUNS = 3;
export const MAX_DESCRIPTION_ITERATIONS = 5;

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TriggerQuery {
  id: string;
  query: string;
  should_trigger: boolean;
}

export interface SplitQuery extends TriggerQuery {
  set: 'train' | 'validation';
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

export function splitTriggerQueries(
  queries: readonly TriggerQuery[],
  seed: number = TRIGGER_SEED,
): SplitQuery[] {
  const random = seededRandom(seed);
  const train = new Set<string>();
  for (const group of [true, false]) {
    const members = queries.filter((query) => query.should_trigger === group);
    const count = Math.round(members.length * TRAIN_SHARE);
    for (const query of shuffled(members, random).slice(0, count)) train.add(query.id);
  }
  return queries.map((query) => ({ ...query, set: train.has(query.id) ? 'train' : 'validation' }));
}

export interface TriggerRunResult {
  id: string;
  run: number;
  fired: boolean;
}

export interface TriggerIterationInput {
  iteration: number;
  description: string;
  results: TriggerRunResult[];
}

export interface TriggerIterationScore {
  iteration: number;
  description_chars: number;
  discarded: boolean;
  discard_reason?: string;
  train_score: number | null;
  validation_score: number | null;
  failed_queries: string[];
  chosen: boolean;
}

export function queryCorrect(
  query: TriggerQuery,
  fires: number,
  minRuns: number,
  runs: number = TRIGGER_RUNS,
): boolean {
  return query.should_trigger ? fires >= minRuns : runs - fires >= minRuns;
}

export function missingTriggerResults(
  queries: readonly TriggerQuery[],
  iteration: TriggerIterationInput,
  runs: number = TRIGGER_RUNS,
): string[] {
  const seen = new Set(iteration.results.map((result) => `${result.id}#${result.run}`));
  const missing: string[] = [];
  for (const query of queries) {
    for (let run = 1; run <= runs; run += 1) {
      if (!seen.has(`${query.id}#${run}`)) missing.push(`${query.id} run ${run}`);
    }
  }
  return missing;
}

export function descriptionOverLimit(description: string, maxTokens?: number): string | null {
  if (maxTokens !== undefined) {
    const tokens = estimateTokens(description);
    return tokens > maxTokens ? `the description is ${tokens} tokens, over ${maxTokens}` : null;
  }
  if (descriptionWithinLimit(description)) return null;
  return `the description is ${descriptionLength(description)} characters, over 1024`;
}

function share(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total;
}

export function scoreTriggerIterations(input: {
  queries: readonly SplitQuery[];
  iterations: readonly TriggerIterationInput[];
  minRuns: number;
  runs?: number;
  maxDescriptionTokens?: number;
}): TriggerIterationScore[] {
  const runs = input.runs ?? TRIGGER_RUNS;
  const scores = input.iterations.map((iteration): TriggerIterationScore => {
    const chars = descriptionLength(iteration.description);
    const overLimit = descriptionOverLimit(iteration.description, input.maxDescriptionTokens);
    if (overLimit !== null) {
      return {
        iteration: iteration.iteration,
        description_chars: chars,
        discarded: true,
        discard_reason: overLimit,
        train_score: null,
        validation_score: null,
        failed_queries: [],
        chosen: false,
      };
    }
    let trainCorrect = 0;
    let validationCorrect = 0;
    const failed: string[] = [];
    for (const query of input.queries) {
      const fires = iteration.results.filter(
        (result) => result.id === query.id && result.fired && result.run <= runs,
      ).length;
      const correct = queryCorrect(query, fires, input.minRuns, runs);
      if (!correct) failed.push(query.id);
      if (correct && query.set === 'train') trainCorrect += 1;
      if (correct && query.set === 'validation') validationCorrect += 1;
    }
    return {
      iteration: iteration.iteration,
      description_chars: chars,
      discarded: false,
      train_score: share(
        trainCorrect,
        input.queries.filter((query) => query.set === 'train').length,
      ),
      validation_score: share(
        validationCorrect,
        input.queries.filter((query) => query.set === 'validation').length,
      ),
      failed_queries: failed,
      chosen: false,
    };
  });
  let best: TriggerIterationScore | null = null;
  for (const score of scores) {
    if (score.discarded || score.validation_score === null) continue;
    if (best === null || score.validation_score > (best.validation_score ?? -1)) best = score;
  }
  if (best !== null) best.chosen = true;
  return scores;
}

export function triggerGatePasses(
  score: TriggerIterationScore | undefined,
  threshold: number,
): boolean {
  return score?.validation_score != null && meetsThreshold(score.validation_score, threshold);
}
