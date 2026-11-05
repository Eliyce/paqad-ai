import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isGeneratedRecipeFolder } from '@/authoring/generated-recipes.js';
import { OPEN_STANDARD_SKILLS_ROOT, enabledAdapters } from '@/authoring/paths.js';

import { RECIPE_NAMES, recipeRoot } from './recipes.js';

const CODEX_ADAPTER = 'codex-cli';
const IGNORE_BEGIN = '# paqad recipes: generated on each machine, kept out of git';
const IGNORE_END = '# end paqad recipes';

function recipeIgnoreBlock(): string {
  return [IGNORE_BEGIN, ...RECIPE_NAMES.map((name) => `/${name}/`), IGNORE_END, ''].join('\n');
}

function readIgnoreFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function writeRecipeIgnore(skillsRoot: string): void {
  const path = join(skillsRoot, '.gitignore');
  const current = readIgnoreFile(path);
  const start = current.indexOf(IGNORE_BEGIN);
  const end = current.indexOf(IGNORE_END);
  const kept =
    start === -1 || end === -1
      ? current
      : `${current.slice(0, start)}${current.slice(end + IGNORE_END.length + 1)}`;
  writeFileSync(
    path,
    `${kept}${kept === '' || kept.endsWith('\n') ? '' : '\n'}${recipeIgnoreBlock()}`,
  );
}

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
  writeRecipeIgnore(skillsRoot);
  return written;
}

export { isGeneratedRecipeFolder };
