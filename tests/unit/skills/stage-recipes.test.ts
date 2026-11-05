import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { renderClaudePluginStageAgents } from '@/stage-isolation/agent-writer.js';

const RECIPES = [
  'planning-recipe',
  'specification-recipe',
  'development-recipe',
  'review-recipe',
  'documentation-sync-recipe',
  'checks-recipe',
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
    const body = readFileSync(join(skillDir('development-recipe'), 'SKILL.md'), 'utf8');
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
    const body = readFileSync(join(skillDir('documentation-sync-recipe'), 'SKILL.md'), 'utf8');
    expect(installPaths(body)).toContain(
      'base/skills/documentation-sync-recipe/scripts/stale-docs.mjs',
    );
  });

  it('the published package keeps the skills the recipes point at', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('runtime');
    expect(pkg.files.filter((entry) => entry.startsWith('!runtime/base'))).toEqual([]);
  });
});
