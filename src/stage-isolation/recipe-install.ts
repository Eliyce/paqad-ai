import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  LEGACY_RECIPE_FOLDER_NAMES,
  isGeneratedRecipeFolder,
} from '@/authoring/generated-recipes.js';
import { hashFolder } from '@/authoring/hash.js';
import { readTextNoFollow } from '@/core/fs/read-no-follow.js';
import { OPEN_STANDARD_SKILLS_ROOT, enabledAdapters } from '@/authoring/paths.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import {
  SKILLS_IGNORE_LINES,
  folderIgnoreIsSymlink,
  writeFolderIgnoreBlock,
} from '@/onboarding/gitignore-writer.js';

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
    const text = readTextNoFollow(join(folder, 'SKILL.md'));
    if (text === null) return null;
    const name = splitFrontMatter(text).header?.['name'];
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

function sameFolder(installed: string, source: string): boolean {
  try {
    return existsSync(installed) && hashFolder(installed) === hashFolder(source);
  } catch {
    return false;
  }
}

export interface RecipeSync {
  written: string[];
  symlinks: string[];
}

export function syncCodexRecipes(
  projectRoot: string,
  source: string | null = recipeRoot(),
): RecipeSync {
  const result: RecipeSync = { written: [], symlinks: [] };
  if (!enabledAdapters(projectRoot).includes(CODEX_ADAPTER)) return result;
  if (source === null) return result;
  const skillsRoot = join(projectRoot, OPEN_STANDARD_SKILLS_ROOT);
  mkdirSync(skillsRoot, { recursive: true });
  for (const name of RECIPE_NAMES) {
    const rel = `${OPEN_STANDARD_SKILLS_ROOT}/${name}`;
    const target = join(skillsRoot, name);
    if (isSymlink(target)) {
      result.symlinks.push(rel);
      continue;
    }
    if (sameFolder(target, join(source, name))) continue;
    if (!replaceRecipe(join(source, name), skillsRoot, name)) continue;
    result.written.push(rel);
  }
  removeLegacyRecipes(skillsRoot);
  if (folderIgnoreIsSymlink(skillsRoot))
    result.symlinks.push(`${OPEN_STANDARD_SKILLS_ROOT}/.gitignore`);
  else writeFolderIgnoreBlock(skillsRoot, SKILLS_IGNORE_LINES);
  return result;
}

export function writeCodexRecipes(
  projectRoot: string,
  source: string | null = recipeRoot(),
): string[] {
  return syncCodexRecipes(projectRoot, source).written;
}

export { isGeneratedRecipeFolder };
