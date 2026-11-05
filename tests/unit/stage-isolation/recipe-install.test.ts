import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { skillCompletionFindings } from '@/authoring/completion.js';
import { renderStageAgentFiles } from '@/stage-isolation/agent-writer.js';
import { RECIPE_NAMES } from '@/stage-isolation/recipes.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { CODEX_RECIPE_LINE, stageTurnsLine } from '@/stage-isolation/recipe-receipt.js';
import { isGeneratedRecipeFolder, writeCodexRecipes } from '@/stage-isolation/recipe-install.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(adapters: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recipe-install-'));
  roots.push(root);
  const manifest = join(root, PATHS.ONBOARDING_MANIFEST);
  mkdirSync(join(manifest, '..'), { recursive: true });
  writeFileSync(
    manifest,
    JSON.stringify({ adapter: adapters[0], providers: adapters, generated_artifacts: [] }),
  );
  return root;
}

function ignored(root: string, path: string): boolean {
  return spawnSync('git', ['check-ignore', '-q', path], { cwd: root }).status === 0;
}

describe('the recipes on a Codex project', () => {
  it('writes six folders, ignores them, and leaves a project skill alone', () => {
    const root = project(['codex-cli']);
    execFileSync('git', ['init', '-q'], { cwd: root });
    expect(writeCodexRecipes(root)).toHaveLength(6);
    expect(existsSync(join(root, '.agents/skills/review-recipe/SKILL.md'))).toBe(true);
    for (const name of RECIPE_NAMES) {
      expect(ignored(root, `.agents/skills/${name}/SKILL.md`)).toBe(true);
    }
    mkdirSync(join(root, '.agents/skills/our-skill'));
    expect(ignored(root, '.agents/skills/our-skill/SKILL.md')).toBe(false);
  });

  it('keeps a project line in the ignore file across a second run', () => {
    const root = project(['codex-cli']);
    writeCodexRecipes(root);
    const file = join(root, '.agents/skills/.gitignore');
    writeFileSync(file, `/ours/\n${readFileSync(file, 'utf8')}`);
    writeCodexRecipes(root);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('/ours/');
    expect(text.match(/review-recipe/gu)).toHaveLength(1);
  });

  it('FR-89: skips a recipe the install lost, and keeps the copy the project has', () => {
    const root = project(['codex-cli']);
    writeCodexRecipes(root);
    const source = mkdtempSync(join(tmpdir(), 'paqad-recipe-source-'));
    roots.push(source);
    mkdirSync(join(source, 'planning-recipe'));
    writeFileSync(join(source, 'planning-recipe/SKILL.md'), 'kept\n');
    expect(writeCodexRecipes(root, source)).toEqual(['.agents/skills/planning-recipe']);
    expect(readFileSync(join(root, '.agents/skills/planning-recipe/SKILL.md'), 'utf8')).toBe(
      'kept\n',
    );
    expect(existsSync(join(root, '.agents/skills/review-recipe/SKILL.md'))).toBe(true);
  });

  it('writes nothing on a project without Codex', () => {
    const root = project(['claude-code']);
    expect(writeCodexRecipes(root)).toEqual([]);
    expect(existsSync(join(root, '.agents'))).toBe(false);
  });

  it('counts an unedited folder as generated, and an edited one as a skill change', () => {
    const root = project(['codex-cli']);
    writeCodexRecipes(root);
    const folder = '.agents/skills/review-recipe';
    expect(isGeneratedRecipeFolder(root, folder, 'review-recipe')).toBe(true);
    const input = {
      projectRoot: root,
      dirName: 'x-01JABCDEFGHJKMNPQRSTVWXYZ0',
      changedFiles: [`${folder}/SKILL.md`],
    };
    expect(skillCompletionFindings(input)).toEqual([]);
    writeFileSync(join(root, folder, 'SKILL.md'), 'edited');
    expect(isGeneratedRecipeFolder(root, folder, 'review-recipe')).toBe(false);
    expect(skillCompletionFindings(input)).toHaveLength(1);
  });

  it('adds the read-first line to the Codex render only, on stage agents only', () => {
    const codex = renderStageAgentFiles('codex-cli');
    expect(codex.find((agent) => agent.name === 'paqad-review.toml')?.content).toContain(
      'Read `.agents/skills/review-recipe/SKILL.md` first',
    );
    expect(codex.find((agent) => agent.name === 'paqad-expert.toml')?.content).not.toContain(
      '.agents/skills',
    );
    for (const agent of renderStageAgentFiles('claude-code')) {
      expect(agent.content).not.toContain('.agents/skills');
    }
    expect(CODEX_RECIPE_LINE).toContain('recipe read, not injected');
  });
});

describe('the turns line in the receipt', () => {
  const row = (stage: string, turns: number) =>
    ({
      kind: 'stage-agent',
      event_status: 'completed',
      stage,
      api_turns: turns,
    }) as unknown as SessionLedgerRow;

  it('AC-65: states turns against the budget and the baseline, summed across agents', () => {
    expect(stageTurnsLine([row('review', 20), row('review', 5), row('checks', 3)])).toBe(
      'Turns per stage: review 25 of 70 (was 44), checks 3 of 20 (was 10).',
    );
  });

  it('says nothing with no turns on record', () => {
    expect(stageTurnsLine([])).toBeNull();
  });
});
