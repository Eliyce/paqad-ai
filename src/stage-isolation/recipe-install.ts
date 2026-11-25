import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  LEGACY_RECIPE_FOLDER_NAMES,
  isGeneratedRecipeFolder,
} from '@/authoring/generated-recipes.js';
import { OPEN_STANDARD_SKILLS_ROOT, enabledAdapters } from '@/authoring/paths.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { SKILLS_IGNORE_LINES, writeFolderIgnoreBlock } from '@/onboarding/gitignore-writer.js';

import { RECIPE_NAMES, recipeRoot } from './recipes.js';

const CODEX_ADAPTER = 'codex-cli';

function stagedCopy(source: string, staged: string): boolean {
  rmSync(staged, { recursive: true, force: true });
  try {
    cpSync(source, staged, { recursive: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function replaceRecipe(source: string, skillsRoot: string, name: string): boolean {
  const target = join(skillsRoot, name);
  const staged = join(skillsRoot, `.${name}.staged`);
  try {
    if (!stagedCopy(source, staged)) return false;
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
    return true;
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

function skillName(folder: string): string | null {
  try {
    const name = splitFrontMatter(readFileSync(join(folder, 'SKILL.md'), 'utf8')).header?.['name'];
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// FR-6: an old unprefixed recipe folder goes only when its folder name AND its
// SKILL.md name both match one of the six old paqad recipe names.
export function removeLegacyRecipes(skillsRoot: string): string[] {
  const removed: string[] = [];
  for (const name of LEGACY_RECIPE_FOLDER_NAMES) {
    const folder = join(skillsRoot, name);
    if (!existsSync(folder) || isSymlink(folder)) continue;
    if (skillName(folder) !== name) continue;
    rmSync(folder, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export function writeCodexRecipes(
  projectRoot: string,
  source: string | null = recipeRoot(),
): string[] {
  if (!enabledAdapters(projectRoot).includes(CODEX_ADAPTER)) return [];
  if (source === null) return [];
  const skillsRoot = join(projectRoot, OPEN_STANDARD_SKILLS_ROOT);
  mkdirSync(skillsRoot, { recursive: true });
  const written: string[] = [];
  for (const name of RECIPE_NAMES) {
    if (!replaceRecipe(join(source, name), skillsRoot, name)) continue;
    written.push(`${OPEN_STANDARD_SKILLS_ROOT}/${name}`);
  }
  removeLegacyRecipes(skillsRoot);
  writeFolderIgnoreBlock(skillsRoot, SKILLS_IGNORE_LINES);
  return written;
}

export { isGeneratedRecipeFolder };
