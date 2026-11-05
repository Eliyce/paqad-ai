import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import '@/stage-isolation/recipes.js';
import { writeCodexRecipes } from '@/stage-isolation/recipe-install.js';

const copying = vi.hoisted(() => ({ failure: null as string | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    cpSync: (...args: Parameters<typeof actual.cpSync>) => {
      if (copying.failure === null) {
        actual.cpSync(...args);
        return;
      }
      const [, staged] = args;
      actual.mkdirSync(String(staged), { recursive: true });
      actual.writeFileSync(join(String(staged), 'partial.md'), 'half a copy\n');
      throw Object.assign(new Error(copying.failure), { code: copying.failure });
    },
  };
});

const RECIPE = '.agents/skills/planning-recipe';

let root: string;
let source: string;

beforeEach(() => {
  copying.failure = null;
  root = mkdtempSync(join(tmpdir(), 'paqad-recipe-copy-'));
  source = mkdtempSync(join(tmpdir(), 'paqad-recipe-copy-source-'));
  const manifest = join(root, PATHS.ONBOARDING_MANIFEST);
  mkdirSync(join(manifest, '..'), { recursive: true });
  writeFileSync(
    manifest,
    JSON.stringify({ adapter: 'codex-cli', providers: ['codex-cli'], generated_artifacts: [] }),
  );
  mkdirSync(join(source, 'planning-recipe'));
  writeFileSync(join(source, 'planning-recipe/SKILL.md'), 'first\n');
  writeCodexRecipes(root, source);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

function stagedFolders(): string[] {
  return readdirSync(join(root, '.agents/skills')).filter((name) => name.includes('staged'));
}

describe('a recipe copy that fails part way', () => {
  it('skips the recipe when its source vanished, and keeps the copy the project has', () => {
    copying.failure = 'ENOENT';
    expect(writeCodexRecipes(root, source)).toEqual([]);
    expect(readdirSync(join(root, RECIPE))).toEqual(['SKILL.md']);
    expect(readFileSync(join(root, RECIPE, 'SKILL.md'), 'utf8')).toBe('first\n');
    expect(stagedFolders()).toEqual([]);
  });

  it('rethrows any other error, and keeps the copy the project has', () => {
    copying.failure = 'EACCES';
    expect(() => writeCodexRecipes(root, source)).toThrow('EACCES');
    expect(readFileSync(join(root, RECIPE, 'SKILL.md'), 'utf8')).toBe('first\n');
    expect(stagedFolders()).toEqual([]);
  });
});
