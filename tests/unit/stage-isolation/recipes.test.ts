import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@/compliance/markdown.js';
import {
  RECIPE_BUDGET_CHARS,
  RECIPE_HEADING,
  fitRecipe,
  recipeRepairAdvice,
  recipeRoot,
  resolveRecipe,
} from '@/stage-isolation/recipes.js';
import { STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';
import { buildStageBrief, seedStageAgentDetailed } from '@/stage-isolation/stage-brief.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recipes-'));
  roots.push(root);
  return root;
}

const body = (text: string) => ({ body: text, bodyPath: '/x/SKILL.md' });

describe('the recipe resolver', () => {
  it('finds every stage recipe from this install, not from the project', () => {
    expect(recipeRoot()).toContain(join('runtime', 'base', 'skills'));
    for (const stage of STAGE_AGENT_STAGES) {
      const recipe = resolveRecipe(stage);
      expect(recipe.body.startsWith('---')).toBe(false);
      expect(recipe.body.length).toBeGreaterThan(0);
    }
    expect(resolveRecipe('checks').scriptPath).toBeNull();
    expect(resolveRecipe('review').scriptName).toBe('lint-findings.mjs');
  });

  it('names paqad-ai update when a recipe is missing', () => {
    expect(() => resolveRecipe('review', tempRoot())).toThrow(/paqad-ai update/u);
    expect(() => resolveRecipe('review', null)).toThrow(/paqad-ai update/u);
  });

  it('FR-89: names the npm install and then the update off the plugin', () => {
    const advice = recipeRepairAdvice('/usr/local/lib/node_modules/paqad-ai');
    expect(advice).toBe('run `npm i -g paqad-ai@latest`, then `paqad-ai update`');
  });

  it('FR-89: on the plugin, says update cannot restore it and names what does', () => {
    const advice = recipeRepairAdvice('/home/me/.claude/plugins/cache/eliyce/paqad/1.2.3');
    expect(advice).toContain('`paqad-ai update` cannot restore it on the plugin');
    expect(advice).toContain('`claude plugin update paqad@eliyce`');
    expect(advice).toContain('already at the latest version');
    expect(advice).toContain('`claude plugin uninstall paqad@eliyce`');
    expect(advice).toContain('`claude plugin install paqad@eliyce`');
    expect(advice).toContain('start a new session');
  });
});

describe('fitting a recipe beside the brief', () => {
  it('AC-54: sends the whole body at the limit, hashing what was sent', () => {
    const recipe = body('x'.repeat(100));
    const size = `${RECIPE_HEADING}\n\n${'x'.repeat(100)}`.length;
    const fitted = fitRecipe(RECIPE_BUDGET_CHARS - size - 2, recipe)!;
    expect(fitted.truncated).toBe(false);
    expect(fitted.hash).toBe(sha256Hex(fitted.text));
  });

  it('AC-54: cuts at a line boundary one over the limit, with a pointer to the file', () => {
    const recipe = body(`one\ntwo\n${'x'.repeat(100)}`);
    const size = `${RECIPE_HEADING}\n\n${recipe.body}`.length;
    const fitted = fitRecipe(RECIPE_BUDGET_CHARS - size - 2 + 1, recipe)!;
    expect(fitted.truncated).toBe(true);
    expect(fitted.text).toContain('/x/SKILL.md');
    expect(fitted.text).not.toContain('xxx');
    expect(fitted.hash).toBe(sha256Hex(fitted.text));
  });

  it('AC-54: counts characters, not bytes', () => {
    const recipe = body('é'.repeat(100));
    const size = `${RECIPE_HEADING}\n\n${recipe.body}`.length;
    expect(fitRecipe(RECIPE_BUDGET_CHARS - size - 2, recipe)?.truncated).toBe(false);
  });

  it('gives up with nothing when no room is left at all', () => {
    expect(fitRecipe(RECIPE_BUDGET_CHARS, body('x'))).toBeNull();
  });
});

describe('the lines a recipe carries', () => {
  it.each(STAGE_AGENT_STAGES)('AC-51: are not repeated in the %s stage instructions', (stage) => {
    const brief = buildStageBrief(stage, process.cwd(), 'ses_seed', { full: true });
    const instructions = brief.slice(
      brief.indexOf('## Stage instructions'),
      brief.indexOf('## Hard rules'),
    );
    const recipeLines = resolveRecipe(stage)
      .body.split('\n')
      .map((line) => line.replace(/^(\d+\.|-)\s+/u, '').trim())
      .filter((line) => line.length > 20);
    for (const line of recipeLines) expect(instructions).not.toContain(line);
  });
});

describe('seeding a stage agent', () => {
  it.each(STAGE_AGENT_STAGES)(
    'AC-54: keeps %s under the host limit, with no recipe text cut',
    (stage) => {
      const root = process.cwd();
      const seeded = seedStageAgentDetailed(stage, root, { session_id: 'ses_seed' }, {});
      const context = (
        JSON.parse(seeded.output) as { hookSpecificOutput: { additionalContext: string } }
      ).hookSpecificOutput.additionalContext;
      expect(context.length).toBeLessThanOrEqual(RECIPE_BUDGET_CHARS);
      expect(context).toContain(`${RECIPE_HEADING}\n\n${resolveRecipe(stage).body}`);
      expect(seeded.injected?.truncated).toBe(false);
      expect(seeded.injected?.recipe_hash).toBe(
        sha256Hex(`${RECIPE_HEADING}\n\n${resolveRecipe(stage).body}`),
      );
      expect(seeded.notes).toEqual([]);
    },
  );
});
