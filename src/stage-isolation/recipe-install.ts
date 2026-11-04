import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hashFolder } from '@/authoring/hash.js';
import { OPEN_STANDARD_SKILLS_ROOT, enabledAdapters } from '@/authoring/paths.js';

import { RECIPE_NAMES, recipeRoot } from './recipes.js';

const CODEX_ADAPTER = 'codex-cli';
const IGNORE_BEGIN = '# paqad recipes: generated on each machine, kept out of git';
const IGNORE_END = '# end paqad recipes';

function recipeIgnoreBlock(): string {
  return [IGNORE_BEGIN, ...RECIPE_NAMES.map((name) => `/${name}/`), IGNORE_END, ''].join('\n');
}

function writeRecipeIgnore(skillsRoot: string): void {
  const path = join(skillsRoot, '.gitignore');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
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

export function writeCodexRecipes(projectRoot: string): string[] {
  if (!enabledAdapters(projectRoot).includes(CODEX_ADAPTER)) return [];
  const source = recipeRoot();
  if (source === null) return [];
  const skillsRoot = join(projectRoot, OPEN_STANDARD_SKILLS_ROOT);
  mkdirSync(skillsRoot, { recursive: true });
  const written: string[] = [];
  for (const name of RECIPE_NAMES) {
    const target = join(skillsRoot, name);
    rmSync(target, { recursive: true, force: true });
    cpSync(join(source, name), target, { recursive: true });
    written.push(`${OPEN_STANDARD_SKILLS_ROOT}/${name}`);
  }
  writeRecipeIgnore(skillsRoot);
  return written;
}

export function isGeneratedRecipeFolder(
  projectRoot: string,
  folder: string,
  name: string,
): boolean {
  if (!RECIPE_NAMES.includes(name) || folder !== `${OPEN_STANDARD_SKILLS_ROOT}/${name}`) {
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
