import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RECIPE_FOLDER_NAMES, recipeRoot } from '@/authoring/generated-recipes.js';
import { getPackageRoot } from '@/core/runtime-paths.js';
import { PLUGIN_ID } from '@/health/plugin-install.js';
import {
  NPM_UPDATE_COMMAND,
  PLUGIN_UPDATE_COMMAND,
  runningFromPlugin,
} from '@/health/running-version-check.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';

export const RECIPE_BUDGET_CHARS = 9_700;

const RECIPE_BY_STAGE: Readonly<Record<string, string>> = {
  planning: 'planning-recipe',
  specification: 'specification-recipe',
  development: 'development-recipe',
  review: 'review-recipe',
  documentation_sync: 'documentation-sync-recipe',
  checks: 'checks-recipe',
};

const RECIPE_SCRIPT: Readonly<Record<string, string>> = {
  'planning-recipe': 'check-plan.mjs',
  'specification-recipe': 'check-spec.mjs',
  'development-recipe': 'check-ac-map.mjs',
  'review-recipe': 'lint-findings.mjs',
  'documentation-sync-recipe': 'stale-docs.mjs',
};

export const RECIPE_NAMES = RECIPE_FOLDER_NAMES;

export { recipeRoot };

export function recipeRepairAdvice(packageRoot: string = getPackageRoot()): string {
  return runningFromPlugin(packageRoot)
    ? `\`paqad-ai update\` cannot restore it on the plugin, so run \`${PLUGIN_UPDATE_COMMAND}\`; if that says it is already at the latest version, run \`claude plugin uninstall ${PLUGIN_ID}\` and then \`claude plugin install ${PLUGIN_ID}\`; then start a new session`
    : `run \`${NPM_UPDATE_COMMAND}\`, then \`paqad-ai update\``;
}

export function recipeNameForStage(stage: string): string | null {
  return RECIPE_BY_STAGE[stage] ?? null;
}

export function recipeHasScript(stage: string): boolean {
  const name = recipeNameForStage(stage);
  return name !== null && RECIPE_SCRIPT[name] !== undefined;
}

export interface ResolvedRecipe {
  name: string;
  root: string;
  bodyPath: string;
  body: string;
  scriptName: string | null;
  scriptPath: string | null;
}

export function resolveRecipe(stage: string, root: string | null = recipeRoot()): ResolvedRecipe {
  const name = recipeNameForStage(stage);
  if (name === null) throw new Error(`no recipe for stage ${stage}`);
  if (root === null) throw new Error(`the ${name} recipe is missing; ${recipeRepairAdvice()}`);
  const bodyPath = join(root, name, 'SKILL.md');
  let text: string;
  try {
    text = readFileSync(bodyPath, 'utf8');
  } catch {
    throw new Error(`the ${name} recipe is missing; ${recipeRepairAdvice()}`);
  }
  const scriptName = RECIPE_SCRIPT[name] ?? null;
  const scriptPath = scriptName === null ? null : join(root, name, 'scripts', scriptName);
  return {
    name,
    root,
    bodyPath,
    body: splitFrontMatter(text).body.trim(),
    scriptName,
    scriptPath,
  };
}

export const RECIPE_HEADING = '## Your recipe';

export interface FittedRecipe {
  text: string;
  hash: string;
  truncated: boolean;
}

export function fitRecipe(
  briefChars: number,
  recipe: Pick<ResolvedRecipe, 'body' | 'bodyPath'>,
  limit: number = RECIPE_BUDGET_CHARS,
): FittedRecipe | null {
  const whole = `${RECIPE_HEADING}\n\n${recipe.body}`;
  const room = limit - briefChars - 2;
  if (whole.length <= room) {
    return { text: whole, hash: sha256Hex(whole), truncated: false };
  }
  const pointer = `\n\nThe rest of this recipe is at \`${recipe.bodyPath}\`. Read it.`;
  if (`${RECIPE_HEADING}${pointer}`.length > room) return null;
  const lines = whole.split('\n');
  let kept = lines.length;
  while (kept > 1 && `${lines.slice(0, kept).join('\n')}${pointer}`.length > room) kept -= 1;
  const text = `${lines.slice(0, kept).join('\n')}${pointer}`;
  return { text, hash: sha256Hex(text), truncated: true };
}
