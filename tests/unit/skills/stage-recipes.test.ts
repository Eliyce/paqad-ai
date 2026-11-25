import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { renderClaudePluginStageAgents } from '@/stage-isolation/agent-writer.js';

const RECIPES = [
  'paqad-planning-recipe',
  'paqad-specification-recipe',
  'paqad-development-recipe',
  'paqad-review-recipe',
  'paqad-documentation-sync-recipe',
  'paqad-checks-recipe',
];

const skillDir = (name: string) => join(process.cwd(), 'runtime/base/skills', name);

describe('the six stage recipes', () => {
  it.each(RECIPES)('%s stays small, restates first, and has no triggers', (name) => {
    const body = readFileSync(join(skillDir(name), 'SKILL.md'), 'utf8');
    expect(body.length).toBeLessThanOrEqual(5_000);
    expect(body).toContain(
      '1. Restate the request and its acceptance criteria in two lines at the top of your return.',
    );
    expect(body).not.toContain('—');
    const meta = readFileSync(join(skillDir(name), 'skill.meta.yaml'), 'utf8');
    expect(meta).toContain('triggers: []');
    expect(readFileSync(join(skillDir(name), 'agents/openai.yaml'), 'utf8')).toContain(
      'allow_implicit_invocation: false',
    );
  });
});

describe('the development recipe', () => {
  it('step 5 says check-ac-map proves a test names a criterion, not that it tests it', () => {
    const body = readFileSync(join(skillDir('paqad-development-recipe'), 'SKILL.md'), 'utf8');
    const stepFive = body.split('\n').find((line) => line.startsWith('5. '));
    expect(stepFive).toContain(
      '`check-ac-map.mjs` proves a test names a criterion, not that it tests it.',
    );
  });
});

describe('every path a recipe names, from an installed layout', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'paqad-recipe-layouts-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function installLink(route: string, packageDir: string): string {
    const runtime = join(scratch, route, packageDir, 'runtime');
    mkdirSync(dirname(runtime), { recursive: true });
    symlinkSync(join(process.cwd(), 'runtime'), runtime);
    const link = join(scratch, route, 'home/.paqad-ai/current');
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(runtime, link);
    return link;
  }

  const LAYOUTS = [
    ['npm', 'lib/node_modules/paqad-ai'],
    ['plugin', 'home/.claude/plugins/cache/eliyce/paqad/1.2.3'],
  ] as const;

  const installPaths = (text: string): string[] =>
    [...text.matchAll(/`(?:node (?:<dir>\/)?)?([^`\s]*)`/gu)]
      .map((match) => match[1]!.replace(/^<dir>\//u, ''))
      .filter((path) => /^(?:runtime\/|base\/|scripts\/)/u.test(path));

  describe.each(LAYOUTS)('on the %s route', (route, packageDir) => {
    const link = installLink(route, packageDir);

    it.each(RECIPES)('%s names only paths that resolve', (name) => {
      const body = readFileSync(join(skillDir(name), 'SKILL.md'), 'utf8');
      for (const path of installPaths(body)) {
        expect(path, `${name} names ${path}`).toMatch(/^base\//u);
        expect(existsSync(join(link, path)), `${name} names ${path}`).toBe(true);
      }
    });

    it('each stage agent names only paths that resolve', () => {
      for (const { name, content } of renderClaudePluginStageAgents()) {
        for (const path of installPaths(content)) {
          expect(path, `${name} names ${path}`).toMatch(/^base\//u);
          expect(existsSync(join(link, path)), `${name} names ${path}`).toBe(true);
        }
      }
    });
  });

  it.each(RECIPES)('%s names a script only by a path or by a name its folder holds', (name) => {
    const body = readFileSync(join(skillDir(name), 'SKILL.md'), 'utf8');
    for (const match of body.matchAll(/`[^`\s]*\.mjs`/gu)) {
      const token = match[0].slice(1, -1);
      expect(token).not.toContain('scripts/');
      expect(existsSync(join(skillDir(name), 'scripts', token)), token).toBe(true);
    }
  });

  it('the documentation recipe names its stale docs script by a full path', () => {
    const body = readFileSync(
      join(skillDir('paqad-documentation-sync-recipe'), 'SKILL.md'),
      'utf8',
    );
    expect(installPaths(body)).toContain(
      'base/skills/paqad-documentation-sync-recipe/scripts/stale-docs.mjs',
    );
  });

  it('the published package keeps the skills the recipes point at', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('runtime');
    expect(pkg.files.filter((entry) => entry.startsWith('!runtime/base'))).toEqual([]);
  });
});

describe('the paqad- recipe names (FR-3, FR-4)', () => {
  it('AC-12: every stage maps to a RECIPE_NAMES entry that starts with paqad-', async () => {
    const { RECIPE_NAMES, recipeNameForStage } = await import('@/stage-isolation/recipes.js');
    for (const stage of [
      'planning',
      'specification',
      'development',
      'review',
      'documentation_sync',
      'checks',
    ]) {
      const name = recipeNameForStage(stage);
      expect(RECIPE_NAMES).toContain(name);
      expect(name?.startsWith('paqad-')).toBe(true);
    }
  });

  it('AC-13: every recipe the 13 agent bodies and the stage brief name is a current paqad- name', async () => {
    const { RECIPE_NAMES } = await import('@/stage-isolation/recipes.js');
    const { renderStageAgentFiles } = await import('@/stage-isolation/agent-writer.js');
    const texts = [
      ...renderStageAgentFiles('claude-code').map((agent) => agent.content),
      ...renderStageAgentFiles('codex-cli').map((agent) => agent.content),
      readFileSync(join(process.cwd(), 'src/stage-isolation/stage-brief.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/stage-isolation/stage-agents.ts'), 'utf8'),
    ];
    for (const text of texts) {
      for (const match of text.matchAll(/[a-z][a-z-]*-recipe\b/gu)) {
        if (match[0] === 'stage-recipe' || match[0] === 'missing-recipe') continue;
        expect(RECIPE_NAMES).toContain(match[0]);
      }
    }
  });

  it('AC-14: each renamed SKILL.md front-matter name equals its folder name', async () => {
    const { RECIPE_NAMES } = await import('@/stage-isolation/recipes.js');
    for (const name of RECIPE_NAMES) {
      const body = readFileSync(
        join(process.cwd(), 'runtime/base/skills', name, 'SKILL.md'),
        'utf8',
      );
      expect(body).toMatch(new RegExp(`^---\\nname: ${name}\\n`, 'u'));
    }
  });
});
