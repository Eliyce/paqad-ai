import { spawnSync } from 'node:child_process';

import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import {
  appendFeatureStageRow,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { stageLedgerEra } from '@/stage-evidence/ledger-era.js';
import { SKILL_USED_KIND } from '@/stage-evidence/types.js';

import { recipeRepairAdvice, resolveRecipe } from './recipes.js';
import { agentNameForStage } from './stage-agents.js';

export type RecipeRunStatus = 'pass' | 'fail' | 'broken';

export interface RecipeRun {
  status: RecipeRunStatus;
  errors: string[];
  hash: string | null;
  recipe: string | null;
  script: string | null;
  root: string | null;
  stale?: string[];
  unchecked?: string;
  scope?: string;
}

const SCRIPT_TIMEOUT_MS = 60_000;

export function runRecipeScript(
  stage: string,
  args: readonly string[],
  input?: string,
  root?: string | null,
): RecipeRun {
  let recipe;
  try {
    recipe = resolveRecipe(stage, root);
  } catch (error) {
    return {
      status: 'broken',
      errors: [(error as Error).message],
      hash: null,
      recipe: null,
      script: null,
      root: null,
    };
  }
  const base = { recipe: recipe.name, script: recipe.scriptName, root: recipe.root };
  if (recipe.scriptPath === null) return { status: 'pass', errors: [], hash: null, ...base };
  const run = spawnSync(process.execPath, [recipe.scriptPath, ...args], {
    encoding: 'utf8',
    timeout: SCRIPT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
  const broken = (why: string): RecipeRun => ({
    status: 'broken',
    errors: [`the ${recipe.name} script ${recipe.scriptName} ${why}; ${recipeRepairAdvice()}`],
    hash: null,
    ...base,
  });
  let parsed: {
    ok?: unknown;
    errors?: unknown;
    hash?: unknown;
    stale?: unknown;
    unchecked?: unknown;
    scope?: unknown;
  };
  try {
    parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '') as typeof parsed;
  } catch {
    return broken('did not run cleanly');
  }
  if (typeof parsed.ok !== 'boolean' || typeof parsed.hash !== 'string') {
    return broken('printed no result');
  }
  return {
    status: parsed.ok ? 'pass' : 'fail',
    errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
    hash: parsed.hash,
    ...base,
    ...(Array.isArray(parsed.stale) ? { stale: parsed.stale.map(String) } : {}),
    ...(typeof parsed.unchecked === 'string' ? { unchecked: parsed.unchecked } : {}),
    ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
  };
}

export type RecipeVerdict = 'skip' | 'pass' | 'refuse' | 'warn';

export interface RecipeCheck {
  verdict: RecipeVerdict;
  run: RecipeRun | null;
  lines: string[];
  record: () => void;
}

export interface RecipeCheckInput {
  projectRoot: string;
  sessionId: string;
  stage: string;
  args: readonly string[];
  input?: string;
  staleOk?: readonly string[];
  root?: string | null;
}

const NOTHING = (): void => {};

function recipeNotes(run: RecipeRun): string[] {
  if (run.unchecked !== undefined) {
    return [`**▸ paqad** · the ${run.recipe} check could not check this: ${run.unchecked}`];
  }
  return run.scope === 'all-tests'
    ? [
        `**▸ paqad** · the ${run.recipe} check could not read this change's diff, so it counted every test in the project`,
      ]
    : [];
}

export function checkRecipe(input: RecipeCheckInput): RecipeCheck {
  const { projectRoot, sessionId, stage } = input;
  const dirName = currentFeature(projectRoot, sessionId);
  if (dirName === null) return { verdict: 'skip', run: null, lines: [], record: NOTHING };
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const lane = readChangeConstants(projectRoot, dirName, rows).lane;
  if (lane === 'fast' || lane === 'graduated') {
    return { verdict: 'skip', run: null, lines: [], record: NOTHING };
  }
  const run = runRecipeScript(stage, input.args, input.input, input.root);
  if (run.status === 'broken') {
    return {
      verdict: 'warn',
      run,
      lines: run.errors.map((line) => `**▸ paqad** · ${line}`),
      record: NOTHING,
    };
  }
  if (run.status === 'fail') {
    const lines = run.errors.map((line) => `- ${line}`);
    const started = rows.filter((row) => row.kind === 'stage_start' && row.stage === stage).at(-1);
    const heldToRecipe = stageLedgerEra(rows, stage) === 'v3' && Boolean(started?.agent_id);
    return heldToRecipe
      ? {
          verdict: 'refuse',
          run,
          lines: [`**▸ paqad** · the ${run.recipe} check found problems:`, ...lines],
          record: NOTHING,
        }
      : {
          verdict: 'warn',
          run,
          lines: [`**▸ paqad** · the ${run.recipe} check found problems (noted only):`, ...lines],
          record: NOTHING,
        };
  }
  const agentId = process.env.SE_AGENT_ID?.trim();
  return {
    verdict: 'pass',
    run,
    lines: recipeNotes(run),
    record: () => {
      if (run.hash === null) return;
      appendFeatureStageRow(projectRoot, sessionId, dirName, {
        kind: SKILL_USED_KIND,
        stage,
        agent: agentNameForStage(stage),
        ...(agentId ? { agent_id: agentId } : {}),
        recipe: run.recipe,
        source: 'script',
        script: run.script,
        output_hash: run.hash,
        recipe_root: run.root,
        ...(run.unchecked === undefined ? {} : { unchecked: run.unchecked }),
        ...(run.scope === undefined ? {} : { scope: run.scope }),
        ...(input.staleOk && input.staleOk.length > 0 ? { stale_ok: [...input.staleOk] } : {}),
      });
    },
  };
}
