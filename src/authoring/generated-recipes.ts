import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashFolder } from './hash.js';
import { OPEN_STANDARD_SKILLS_ROOT } from './paths.js';

export const RECIPE_FOLDER_NAMES: readonly string[] = [
  'planning-recipe',
  'specification-recipe',
  'development-recipe',
  'review-recipe',
  'documentation-sync-recipe',
  'checks-recipe',
];

const SKILLS_RELATIVE = join('runtime', 'base', 'skills');

export function recipeRoot(from: string = fileURLToPath(import.meta.url)): string | null {
  let dir = dirname(from);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, SKILLS_RELATIVE))) return join(dir, SKILLS_RELATIVE);
    dir = dirname(dir);
  }
  return null;
}

export function isGeneratedRecipeFolder(
  projectRoot: string,
  folder: string,
  name: string,
): boolean {
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
