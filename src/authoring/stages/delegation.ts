import { readAuthoringConfig } from '../config.js';
import {
  MAX_DESCRIPTION_ITERATIONS,
  queryCorrect,
  missingTriggerResults,
  scoreTriggerIterations,
  splitTriggerQueries,
  triggerGatePasses,
  TRIGGER_RUNS,
  TRIGGER_SEED,
  type SplitQuery,
  type TriggerIterationScore,
} from '../eval/split.js';
import { planSpend, recordSpend } from '../eval/spend.js';
import { withDescription } from '../hash.js';
import { AuthoringRefusal, requireEarlierGates, type AuthoringWorkspace } from '../workspace.js';
import { agentDraftFile } from './agent-draft.js';
import { readAgentIntake } from './agent-intake.js';
import { draftAgentHash } from './agent-test.js';
import type { StageResult } from './result.js';
import { parseQueries } from './trigger.js';

export const DELEGATION_EVAL_FILE = 'delegation-eval.json';
export const DELEGATION_RESULTS_FILE = 'delegation-results.json';
export const DELEGATION_GROUP_MIN = 8;
export const DELEGATION_GROUP_MAX = 10;
export const FRESH_MIN = 5;
export const FRESH_MAX = 10;

export interface DelegationEval {
  seed: number;
  runs: number;
  threshold: number;
  min_runs: number;
  batch: 'offered' | 'not-offered' | 'off';
  worst_case_spend_usd: number;
  queries: SplitQuery[];
}

function isDispatched(workspace: AuthoringWorkspace): boolean {
  return readAgentIntake(workspace)?.invocation === 'dispatched';
}

function skipDispatched(workspace: AuthoringWorkspace): StageResult {
  const artifact = workspace.writeJson(DELEGATION_RESULTS_FILE, {
    gate: 'skipped',
    stage: 'S6',
    skipped: 'dispatched',
    reason: 'a dispatched agent is only ever called by name',
    inputs_hash: workspace.exists(agentDraftFile(workspace)) ? draftAgentHash(workspace) : null,
  });
  return {
    ok: true,
    artifacts: [artifact],
    lines: [
      `${workspace.name} is dispatched (called by name only), so S6 is skipped.`,
      `Next: paqad-ai agent release ${workspace.name}`,
    ],
  };
}

function requestsText(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return text;
    return JSON.stringify(
      parsed.map((entry) => {
        const row = entry as { id?: unknown; request?: unknown; should_delegate?: unknown };
        return { id: row.id, query: row.request, should_trigger: row.should_delegate };
      }),
    );
  } catch {
    return text;
  }
}

export function runDelegationPlan(
  workspace: AuthoringWorkspace,
  text: string | null,
  options: { batchOffered?: boolean } = {},
): StageResult {
  requireEarlierGates(workspace, 'S6');
  if (isDispatched(workspace)) return skipDispatched(workspace);
  if (text === null) {
    throw new AuthoringRefusal(
      'delegation plan needs <requests.json> as [{request, should_delegate}].',
      2,
    );
  }
  const config = readAuthoringConfig(workspace.projectRoot);
  const queries = parseQueries(requestsText(text));
  const positives = queries.filter((query) => query.should_trigger).length;
  const negatives = queries.length - positives;
  const inRange = (count: number) => count >= DELEGATION_GROUP_MIN && count <= DELEGATION_GROUP_MAX;
  if (!inRange(positives) || !inRange(negatives)) {
    throw new AuthoringRefusal(
      `S6 needs ${DELEGATION_GROUP_MIN} to ${DELEGATION_GROUP_MAX} should-delegate requests and ${DELEGATION_GROUP_MIN} to ${DELEGATION_GROUP_MAX} near-misses; found ${positives} and ${negatives}.`,
    );
  }
  const worst =
    Math.round(
      (queries.length * TRIGGER_RUNS * MAX_DESCRIPTION_ITERATIONS + FRESH_MAX * TRIGGER_RUNS) *
        config.authoring_run_max_cost_usd *
        1e6,
    ) / 1e6;
  const total = planSpend(workspace, 'S6', worst);
  const evalFile: DelegationEval = {
    seed: TRIGGER_SEED,
    runs: TRIGGER_RUNS,
    threshold: config.agent_delegation_threshold,
    min_runs: config.authoring_trigger_min_runs,
    batch:
      config.authoring_batch_mode === 'off'
        ? 'off'
        : options.batchOffered === true
          ? 'offered'
          : 'not-offered',
    worst_case_spend_usd: worst,
    queries: splitTriggerQueries(queries),
  };
  const artifact = workspace.writeJson(DELEGATION_EVAL_FILE, evalFile);
  const train = evalFile.queries.filter((query) => query.set === 'train').length;
  return {
    ok: true,
    artifacts: [artifact],
    lines: [
      `${queries.length} requests (${positives} should delegate, ${negatives} near-misses), split ${train} train / ${queries.length - train} validation with seed ${TRIGGER_SEED}. Worst-case spend $${worst} (planned total for this agent: $${total}).`,
      `Run each request ${TRIGGER_RUNS} times per description, revise from train failures only (up to ${MAX_DESCRIPTION_ITERATIONS} iterations), then run ${FRESH_MIN} to ${FRESH_MAX} fresh requests on the host. Batch: ${evalFile.batch}.`,
      `Then run paqad-ai agent delegation record ${workspace.name} <results.json>.`,
    ],
  };
}

interface FreshCheck {
  request: string;
  should_delegate: boolean;
  runs: boolean[];
  source: string;
}

interface ResultsFile {
  iterations: Array<{
    iteration: number;
    description: string;
    source: 'host' | 'batch';
    results: Array<{ id: string; run: number; fired: boolean }>;
  }>;
  fresh: FreshCheck[];
  cost: number | null;
}

function parseDelegationResults(text: string): ResultsFile {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AuthoringRefusal('The results file is not valid JSON.');
  }
  if (!Array.isArray(parsed.iterations) || parsed.iterations.length === 0) {
    throw new AuthoringRefusal('The results file is missing iterations[].');
  }
  const iterations = parsed.iterations.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    if (typeof entry.description !== 'string' || !Array.isArray(entry.results)) {
      throw new AuthoringRefusal(`iterations[${index}] is missing description or results[].`);
    }
    return {
      iteration: typeof entry.iteration === 'number' ? entry.iteration : index + 1,
      description: entry.description,
      source: entry.source === 'batch' ? ('batch' as const) : ('host' as const),
      results: (entry.results as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        run: Number(row.run),
        fired: row.fired === true,
      })),
    };
  });
  const fresh = (Array.isArray(parsed.fresh) ? parsed.fresh : []).map((raw) => {
    const entry = raw as Record<string, unknown>;
    return {
      request: String(entry.request ?? ''),
      should_delegate: entry.should_delegate === true,
      runs: Array.isArray(entry.runs) ? entry.runs.map((run) => run === true) : [],
      source: typeof entry.source === 'string' ? entry.source : 'host',
    };
  });
  return { iterations, fresh, cost: typeof parsed.cost_usd === 'number' ? parsed.cost_usd : null };
}

function freshVerdict(fresh: readonly FreshCheck[], minRuns: number) {
  const hostRun = fresh.filter((entry) => entry.source === 'host');
  const failed = hostRun.filter(
    (entry) =>
      !queryCorrect(
        { id: entry.request, query: entry.request, should_trigger: entry.should_delegate },
        entry.runs.filter(Boolean).length,
        minRuns,
        entry.runs.length,
      ),
  );
  return {
    host_run: hostRun.length,
    ignored_non_host: fresh.length - hostRun.length,
    failed: failed.map((entry) => entry.request),
  };
}

export function runDelegationRecord(
  workspace: AuthoringWorkspace,
  resultsText: string | null,
  options: { change?: string | null } = {},
): StageResult {
  requireEarlierGates(workspace, 'S6');
  if (isDispatched(workspace)) return skipDispatched(workspace);
  const evalFile = workspace.readJson<DelegationEval>(DELEGATION_EVAL_FILE);
  if (evalFile === null) {
    throw new AuthoringRefusal(
      `${workspace.relPath(DELEGATION_EVAL_FILE)} is missing. Run paqad-ai agent delegation plan ${workspace.name} <requests.json> first.`,
    );
  }
  if (resultsText === null)
    throw new AuthoringRefusal('delegation record needs <results.json>.', 2);
  const config = readAuthoringConfig(workspace.projectRoot);
  const results = parseDelegationResults(resultsText);
  if (results.iterations.length > MAX_DESCRIPTION_ITERATIONS) {
    throw new AuthoringRefusal(
      `S6 allows at most ${MAX_DESCRIPTION_ITERATIONS} description iterations; found ${results.iterations.length}.`,
    );
  }
  for (const iteration of results.iterations) {
    const missing = missingTriggerResults(evalFile.queries, iteration, evalFile.runs);
    if (missing.length > 0) {
      throw new AuthoringRefusal(
        `Iteration ${iteration.iteration} is missing results for ${missing.join(', ')}.`,
      );
    }
  }
  const scores: Array<TriggerIterationScore & { source: string }> = scoreTriggerIterations({
    queries: evalFile.queries,
    iterations: results.iterations,
    minRuns: evalFile.min_runs,
    runs: evalFile.runs,
    maxDescriptionTokens: config.agent_description_max_tokens,
  }).map((score) => ({
    ...score,
    source: results.iterations.find((entry) => entry.iteration === score.iteration)!.source,
  }));
  const chosen = scores.find((score) => score.chosen);
  const fresh = freshVerdict(results.fresh, evalFile.min_runs);
  const reasons: string[] = [];
  if (!triggerGatePasses(chosen, evalFile.threshold)) {
    reasons.push(
      chosen
        ? `the best validation score is ${chosen.validation_score}; it needs ${evalFile.threshold}`
        : 'every iteration was discarded',
    );
  }
  if (fresh.host_run < FRESH_MIN || fresh.host_run > FRESH_MAX) {
    reasons.push(
      `S6 needs ${FRESH_MIN} to ${FRESH_MAX} fresh requests run on the host; found ${fresh.host_run}`,
    );
  }
  if (fresh.failed.length > 0)
    reasons.push(`fresh requests delegated wrongly: ${fresh.failed.join(', ')}`);
  const spend = recordSpend(workspace, 'S6', results.cost ?? 0, options.change);
  const passed = reasons.length === 0;
  const description = chosen
    ? results.iterations.find((entry) => entry.iteration === chosen.iteration)!.description
    : null;
  const draft = agentDraftFile(workspace);
  const published = passed && description !== null && workspace.exists(draft);
  if (published) workspace.write(draft, withDescription(workspace.read(draft)!, description!));
  const artifact = workspace.writeJson(DELEGATION_RESULTS_FILE, {
    gate: passed ? 'passed' : 'failed',
    stage: 'S6',
    ...(passed ? {} : { reason: reasons.join('; ') }),
    threshold: evalFile.threshold,
    min_runs: evalFile.min_runs,
    chosen_iteration: chosen?.iteration ?? null,
    chosen_score: chosen?.validation_score ?? null,
    chosen_description: description,
    iterations: scores,
    fresh,
    creation_cost_usd: { S6: results.cost },
    spend,
    inputs_hash: published ? draftAgentHash(workspace) : null,
  });
  const table = scores.map(
    (score) =>
      `iteration ${score.iteration} (${score.source}): ${score.discarded ? `discarded, ${score.discard_reason}` : `validation ${score.validation_score}`}${score.chosen ? ' <- chosen' : ''}`,
  );
  return {
    ok: passed,
    artifacts: [artifact],
    lines: [
      ...table,
      passed
        ? `S6 passed: the chosen description scores ${chosen!.validation_score} on validation and every fresh host request delegated right; it is now in the draft. Next: paqad-ai agent release ${workspace.name}`
        : `S6 failed: ${reasons.join('; ')}.`,
    ],
  };
}
