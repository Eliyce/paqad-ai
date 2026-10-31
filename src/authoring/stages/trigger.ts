import { existsSync as fileExists, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readAuthoringConfig } from '../config.js';
import {
  MAX_DESCRIPTION_ITERATIONS,
  missingTriggerResults,
  scoreTriggerIterations,
  splitTriggerQueries,
  TRIGGER_RUNS,
  TRIGGER_SEED,
  triggerGatePasses,
  type SplitQuery,
  type TriggerIterationInput,
  type TriggerQuery,
} from '../eval/split.js';
import { hashFolder, withDescription } from '../hash.js';
import { buildOverlapReport, discoverInstalledSkills } from '../overlap.js';
import { readSkillPathContext, SKILL_FILE } from '../paths.js';
import { AuthoringRefusal, requireEarlierGates, type SkillWorkspace } from '../workspace.js';
import { draftFolder } from './draft.js';
import type { StageResult } from './result.js';

export const TRIGGER_EVAL_FILE = 'trigger-eval.json';
export const TRIGGER_RESULTS_FILE = 'trigger-results.json';

export interface TriggerEval {
  seed: number;
  runs: number;
  threshold: number;
  min_runs: number;
  batch: 'offered' | 'not-offered' | 'off';
  queries: SplitQuery[];
}

function parseQueries(text: string): TriggerQuery[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthoringRefusal(
      'The queries file is not valid JSON: expected [{query, should_trigger}].',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new AuthoringRefusal('The queries file must be a JSON array of {query, should_trigger}.');
  }
  return parsed.map((raw, index) => {
    const entry = raw as { id?: unknown; query?: unknown; should_trigger?: unknown };
    if (typeof entry.query !== 'string' || typeof entry.should_trigger !== 'boolean') {
      throw new AuthoringRefusal(`Query ${index + 1} is missing query or should_trigger.`);
    }
    return {
      id: typeof entry.id === 'string' ? entry.id : `q-${String(index + 1).padStart(2, '0')}`,
      query: entry.query,
      should_trigger: entry.should_trigger,
    };
  });
}

export function runTriggerPlan(workspace: SkillWorkspace, queriesText: string): StageResult {
  requireEarlierGates(workspace, 'S6');
  const config = readAuthoringConfig(workspace.projectRoot);
  const queries = parseQueries(queriesText);
  const positives = queries.filter((query) => query.should_trigger).length;
  const negatives = queries.length - positives;
  if (positives < 1 || negatives < 1) {
    throw new AuthoringRefusal(
      'The trigger set needs queries that should trigger and near-misses that should not.',
    );
  }
  const evalFile: TriggerEval = {
    seed: TRIGGER_SEED,
    runs: TRIGGER_RUNS,
    threshold: config.authoring_trigger_threshold,
    min_runs: config.authoring_trigger_min_runs,
    batch: config.authoring_batch_mode === 'off' ? 'off' : 'not-offered',
    queries: splitTriggerQueries(queries),
  };
  const artifact = workspace.writeJson(TRIGGER_EVAL_FILE, evalFile);
  const train = evalFile.queries.filter((query) => query.set === 'train').length;
  return {
    ok: true,
    artifacts: [artifact],
    lines: [
      `${queries.length} queries (${positives} should trigger, ${negatives} near-misses), split ${train} train / ${queries.length - train} validation with seed ${TRIGGER_SEED}.`,
      `Run each query ${TRIGGER_RUNS} times per description, revise the description from train failures only (up to ${MAX_DESCRIPTION_ITERATIONS} iterations), ` +
        `cost capped at $${config.authoring_run_max_cost_usd}. Batch: ${evalFile.batch}.`,
      `Then run paqad-ai skill trigger record ${workspace.name} <results.json>.`,
    ],
  };
}

interface TriggerResultsFile {
  iterations?: unknown;
  cost_usd?: unknown;
}

function parseResults(text: string): { iterations: TriggerIterationInput[]; cost: number | null } {
  let parsed: TriggerResultsFile;
  try {
    parsed = JSON.parse(text) as TriggerResultsFile;
  } catch {
    throw new AuthoringRefusal('The results file is not valid JSON.');
  }
  if (!Array.isArray(parsed.iterations) || parsed.iterations.length === 0) {
    throw new AuthoringRefusal('The results file is missing iterations[].');
  }
  const iterations = parsed.iterations.map((raw, index) => {
    const entry = raw as { iteration?: unknown; description?: unknown; results?: unknown };
    if (typeof entry.description !== 'string' || !Array.isArray(entry.results)) {
      throw new AuthoringRefusal(`iterations[${index}] is missing description or results[].`);
    }
    return {
      iteration: typeof entry.iteration === 'number' ? entry.iteration : index + 1,
      description: entry.description,
      results: entry.results.map((result) => {
        const row = result as { id?: unknown; run?: unknown; fired?: unknown };
        return { id: String(row.id), run: Number(row.run), fired: row.fired === true };
      }),
    };
  });
  return {
    iterations,
    cost: typeof parsed.cost_usd === 'number' ? parsed.cost_usd : null,
  };
}

export function runTriggerRecord(
  workspace: SkillWorkspace,
  resultsText: string,
  options: { userHome?: string | null } = {},
): StageResult {
  requireEarlierGates(workspace, 'S6');
  const evalFile = workspace.readJson<TriggerEval>(TRIGGER_EVAL_FILE);
  if (evalFile === null) {
    throw new AuthoringRefusal(
      `${workspace.relPath(TRIGGER_EVAL_FILE)} is missing. Run paqad-ai skill trigger plan ${workspace.name} first.`,
    );
  }
  const config = readAuthoringConfig(workspace.projectRoot);
  const { iterations, cost } = parseResults(resultsText);
  if (iterations.length > MAX_DESCRIPTION_ITERATIONS) {
    throw new AuthoringRefusal(
      `S6 allows at most ${MAX_DESCRIPTION_ITERATIONS} description iterations; found ${iterations.length}.`,
    );
  }
  for (const iteration of iterations) {
    const missing = missingTriggerResults(evalFile.queries, iteration, evalFile.runs);
    if (missing.length > 0) {
      throw new AuthoringRefusal(
        `Iteration ${iteration.iteration} is missing results for ${missing.join(', ')}.`,
      );
    }
  }
  const scores = scoreTriggerIterations({
    queries: evalFile.queries,
    iterations,
    minRuns: evalFile.min_runs,
    runs: evalFile.runs,
  });
  const chosen = scores.find((score) => score.chosen);
  const chosenDescription = chosen
    ? iterations.find((iteration) => iteration.iteration === chosen.iteration)!.description
    : null;
  const reasons: string[] = [];
  if (!triggerGatePasses(chosen, evalFile.threshold)) {
    reasons.push(
      chosen
        ? `the best validation score is ${chosen.validation_score}; it needs ${evalFile.threshold}`
        : 'every iteration was discarded',
    );
  }
  const overCap = cost !== null && cost > config.authoring_run_max_cost_usd;
  if (overCap)
    reasons.push(`the sweep cost $${cost}, over the cap of $${config.authoring_run_max_cost_usd}`);
  if (chosenDescription !== null) {
    const report = buildOverlapReport({
      candidate: { kind: 'skill', name: workspace.name, text: chosenDescription, scope: 'project' },
      installed: discoverInstalledSkills(
        workspace.projectRoot,
        readSkillPathContext(workspace.projectRoot),
        {
          userHome: options.userHome,
        },
      ),
      threshold: config.authoring_collision_jaccard,
      budgetChars: config.authoring_description_budget_chars,
    });
    const first = report.collisions[0];
    if (first) {
      reasons.push(
        `the final description collides with ${first.existing} (${first.score.toFixed(2)})`,
      );
    }
  }
  const folder = workspace.path(draftFolder(workspace));
  const passed = reasons.length === 0;
  const skillFile = join(folder, SKILL_FILE);
  const published = passed && chosenDescription !== null && fileExists(skillFile);
  if (published) {
    writeFileSync(
      skillFile,
      withDescription(readFileSync(skillFile, 'utf8'), chosenDescription!),
      'utf8',
    );
  }
  const artifact = workspace.writeJson(TRIGGER_RESULTS_FILE, {
    gate: passed ? 'passed' : 'failed',
    stage: 'S6',
    ...(passed ? {} : { reason: reasons.join('; ') }),
    seed: evalFile.seed,
    threshold: evalFile.threshold,
    batch: evalFile.batch,
    cost_usd: cost,
    ...(overCap ? { partial: true } : {}),
    chosen_iteration: chosen?.iteration ?? null,
    validation_score: chosen?.validation_score ?? null,
    description: chosenDescription,
    description_chars: chosen?.description_chars ?? null,
    inputs_hash: published ? hashFolder(folder) : null,
    iterations: scores,
  });
  const lines = scores.map(
    (score) =>
      `Iteration ${score.iteration}: ${score.discarded ? `discarded (${score.discard_reason})` : `train ${score.train_score}, validation ${score.validation_score}`}${score.chosen ? ' (chosen)' : ''}`,
  );
  lines.push(
    passed
      ? `S6 passed with iteration ${chosen!.iteration}; its description is now in the draft SKILL.md. Next: paqad-ai skill release ${workspace.name}.`
      : `S6 failed: ${reasons.join('; ')}.`,
  );
  return { ok: passed, artifacts: [artifact], lines };
}
