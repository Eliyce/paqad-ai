import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export const RECIPE_NAMES: readonly string[] = Object.values(RECIPE_BY_STAGE);

const SKILLS_RELATIVE = join('runtime', 'base', 'skills');

export function recipeRoot(from: string = fileURLToPath(import.meta.url)): string | null {
  let dir = dirname(from);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, SKILLS_RELATIVE))) return join(dir, SKILLS_RELATIVE);
    dir = dirname(dir);
  }
  return null;
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
  if (root === null) throw new Error(`the ${name} recipe is missing; run \`paqad-ai update\``);
  const bodyPath = join(root, name, 'SKILL.md');
  let text: string;
  try {
    text = readFileSync(bodyPath, 'utf8');
  } catch {
    throw new Error(`the ${name} recipe is missing; run \`paqad-ai update\``);
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
