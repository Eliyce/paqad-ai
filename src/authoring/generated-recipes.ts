import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitFrontMatter } from '@/feature-evidence/envelope.js';

import { hashFolder } from './hash.js';
import { OPEN_STANDARD_SKILLS_ROOT } from './paths.js';

export const RECIPE_FOLDER_NAMES: readonly string[] = [
  'paqad-planning-recipe',
  'paqad-specification-recipe',
  'paqad-development-recipe',
  'paqad-review-recipe',
  'paqad-documentation-sync-recipe',
  'paqad-checks-recipe',
];

export const LEGACY_RECIPE_FOLDER_NAMES: readonly string[] = RECIPE_FOLDER_NAMES.map((name) =>
  name.replace(/^paqad-/u, ''),
);

const SKILLS_RELATIVE = join('runtime', 'base', 'skills');

export function recipeRoot(from: string = fileURLToPath(import.meta.url)): string | null {
  let dir = dirname(from);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, SKILLS_RELATIVE))) return join(dir, SKILLS_RELATIVE);
    dir = dirname(dir);
  }
  return null;
}

function legacyNameMatches(abs: string, name: string): boolean {
  try {
    return splitFrontMatter(readFileSync(join(abs, 'SKILL.md'), 'utf8')).header?.['name'] === name;
  } catch {
    return false;
  }
}

export function isGeneratedRecipeFolder(
  projectRoot: string,
  folder: string,
  name: string,
): boolean {
  if (
    LEGACY_RECIPE_FOLDER_NAMES.includes(name) &&
    folder === `${OPEN_STANDARD_SKILLS_ROOT}/${name}`
  ) {
    return legacyNameMatches(join(projectRoot, folder), name);
  }
  if (!RECIPE_FOLDER_NAMES.includes(name) || folder !== `${OPEN_STANDARD_SKILLS_ROOT}/${name}`) {
    return false;
  }
  const source = recipeRoot();
  if (source === null) return false;
  try {
    return hashFolder(join(projectRoot, folder)) === hashFolder(join(source, name));
  } catch {
    return false;
  }
}
