import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { checkRecipe, runRecipeScript } from '@/stage-isolation/recipe-check.js';

const SESSION = 'ses_recipe_outcomes';
const HASH = 'a'.repeat(64);

describe('recipe check outcomes', () => {
  let root: string;
  let recipes: string;
  let dir: string;

  const open = (lane: 'full' | 'fast' = 'full') =>
    openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'Recipes',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXY30',
      lane,
    });

  beforeEach(() => {
    vi.stubEnv('SE_AGENT_ID', '');
    root = mkdtempSync(join(tmpdir(), 'paqad-recipe-outcomes-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    recipes = join(root, 'recipes');
    dir = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const script = (name: string, file: string, body: string) => {
    mkdirSync(join(recipes, name, 'scripts'), { recursive: true });
    writeFileSync(join(recipes, name, 'SKILL.md'), `---\nname: ${name}\n---\n\nbody\n`);
    writeFileSync(join(recipes, name, 'scripts', file), body);
  };
  const reviewScript = (result: unknown) =>
    script(
      'review-recipe',
      'lint-findings.mjs',
      `console.log('progress');console.log(${JSON.stringify(JSON.stringify(result))});`,
    );
  const check = (extra: Record<string, unknown> = {}) =>
    checkRecipe({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'review',
      args: [],
      root: recipes,
      ...extra,
    });
  const skillRows = () =>
    readFeatureStageUnit(root, dir).filter((row) => row.kind === 'skill-used');

  describe('runRecipeScript', () => {
    it('is broken with the stage named when the stage has no recipe', () => {
      expect(runRecipeScript('not-a-stage', [])).toMatchObject({
        status: 'broken',
        errors: ['no recipe for stage not-a-stage'],
        hash: null,
        recipe: null,
      });
    });

    it('is broken with repair advice when the recipe folder is gone', () => {
      const run = runRecipeScript('review', [], undefined, null);
      expect(run.status).toBe('broken');
      expect(run.errors[0]).toContain('the review-recipe recipe is missing');
    });

    it('passes without running anything for a recipe with no script', () => {
      mkdirSync(join(recipes, 'checks-recipe'), { recursive: true });
      writeFileSync(join(recipes, 'checks-recipe', 'SKILL.md'), 'body');
      expect(runRecipeScript('checks', [], undefined, recipes)).toEqual({
        status: 'pass',
        errors: [],
        hash: null,
        recipe: 'checks-recipe',
        script: null,
        root: recipes,
      });
    });

    it('is broken when the script crashes before printing JSON', () => {
      script('review-recipe', 'lint-findings.mjs', "throw new Error('boom');");
      const run = runRecipeScript('review', [], undefined, recipes);
      expect(run.status).toBe('broken');
      expect(run.errors[0]).toContain('lint-findings.mjs did not run cleanly');
    });

    it.each([
      ['no ok flag', { hash: HASH }],
      ['no hash', { ok: true }],
    ])('is broken when the result has %s', (_name, result) => {
      reviewScript(result);
      const run = runRecipeScript('review', [], undefined, recipes);
      expect(run.status).toBe('broken');
      expect(run.errors[0]).toContain('printed no result');
    });

    it('reads a failure with its errors, stale list and notes, stringifying them', () => {
      reviewScript({
        ok: false,
        hash: HASH,
        errors: ['one', 2],
        stale: ['doc.md', 3],
        unchecked: 'no git',
        scope: 'all-tests',
      });
      expect(runRecipeScript('review', [], undefined, recipes)).toMatchObject({
        status: 'fail',
        errors: ['one', '2'],
        hash: HASH,
        stale: ['doc.md', '3'],
        unchecked: 'no git',
        scope: 'all-tests',
      });
    });

    it('leaves out fields of the wrong shape', () => {
      reviewScript({
        ok: true,
        hash: HASH,
        errors: 'not a list',
        stale: 'x',
        unchecked: 1,
        scope: 2,
      });
      const run = runRecipeScript('review', [], undefined, recipes);
      expect(run.errors).toEqual([]);
      expect(run).not.toHaveProperty('stale');
      expect(run).not.toHaveProperty('unchecked');
      expect(run).not.toHaveProperty('scope');
    });

    it('passes stdin through to the script', () => {
      script(
        'review-recipe',
        'lint-findings.mjs',
        `import { readFileSync } from 'node:fs';
         const hash = readFileSync(0, 'utf8');
         console.log(JSON.stringify({ ok: true, hash }));`,
      );
      expect(runRecipeScript('review', [], 'piped', recipes).hash).toBe('piped');
    });
  });

  describe('checkRecipe', () => {
    it('skips when no change is active', () => {
      expect(check()).toMatchObject({ verdict: 'skip', run: null, lines: [] });
    });

    it('skips on the fast lane, and its record writes nothing', () => {
      dir = open('fast');
      const result = check();
      expect(result.verdict).toBe('skip');
      result.record();
      expect(skillRows()).toEqual([]);
    });

    it('warns and never refuses when the script is broken', () => {
      dir = open();
      script('review-recipe', 'lint-findings.mjs', "throw new Error('boom');");
      const result = check();
      expect(result.verdict).toBe('warn');
      expect(result.lines[0]).toContain('did not run cleanly');
      result.record();
      expect(skillRows()).toEqual([]);
    });

    it('notes a failure only for an inline stage with no agent on its start row', () => {
      dir = open();
      appendFeatureStageRow(root, SESSION, dir, { kind: 'stage_start', stage: 'review' });
      reviewScript({ ok: false, hash: HASH, errors: ['bad finding'] });
      const result = check();
      expect(result.verdict).toBe('warn');
      expect(result.lines).toEqual([
        '**▸ paqad** · the review-recipe check found problems (noted only):',
        '- bad finding',
      ]);
    });

    it('notes a failure only when the stage never started', () => {
      dir = open();
      reviewScript({ ok: false, hash: HASH, errors: ['bad finding'] });
      expect(check().verdict).toBe('warn');
    });

    it('refuses a failure from a dispatched agent and records nothing', () => {
      dir = open();
      appendFeatureStageRow(root, SESSION, dir, {
        kind: 'stage_start',
        stage: 'review',
        agent_id: 'a1',
      });
      reviewScript({ ok: false, hash: HASH, errors: ['bad finding'] });
      const result = check();
      expect(result.verdict).toBe('refuse');
      expect(result.lines).toEqual([
        '**▸ paqad** · the review-recipe check found problems:',
        '- bad finding',
      ]);
      result.record();
      expect(skillRows()).toEqual([]);
    });

    it('records a pass under the env agent, with no notes', () => {
      dir = open();
      vi.stubEnv('SE_AGENT_ID', ' a-env ');
      reviewScript({ ok: true, hash: HASH });
      const result = check();
      expect(result.verdict).toBe('pass');
      expect(result.lines).toEqual([]);
      result.record();
      expect(skillRows()[0]).toMatchObject({
        stage: 'review',
        agent: 'paqad-review',
        agent_id: 'a-env',
        recipe: 'review-recipe',
        script: 'lint-findings.mjs',
        output_hash: HASH,
        source: 'script',
      });
      expect(skillRows()[0]).not.toHaveProperty('unchecked');
      expect(skillRows()[0]).not.toHaveProperty('scope');
      expect(skillRows()[0]).not.toHaveProperty('stale_ok');
    });

    it('records a pass under the agent that started the stage', () => {
      dir = open();
      appendFeatureStageRow(root, SESSION, dir, {
        kind: 'stage_start',
        stage: 'review',
        agent_id: 'a-started',
      });
      reviewScript({ ok: true, hash: HASH });
      check().record();
      expect(skillRows()[0]).toMatchObject({ agent_id: 'a-started' });
    });

    it('records a pass with no agent for an inline stage', () => {
      dir = open();
      reviewScript({ ok: true, hash: HASH });
      check().record();
      expect(skillRows()[0]).not.toHaveProperty('agent_id');
    });

    it('says what it could not check, and keeps that on the row', () => {
      dir = open();
      reviewScript({ ok: true, hash: HASH, unchecked: 'no spec' });
      const result = check();
      expect(result.lines).toEqual([
        '**▸ paqad** · the review-recipe check could not check this: no spec',
      ]);
      result.record();
      expect(skillRows()[0]).toMatchObject({ unchecked: 'no spec' });
    });

    it('says when it fell back to every test, and keeps the scope and stale list', () => {
      dir = open();
      reviewScript({ ok: true, hash: HASH, scope: 'all-tests' });
      const result = check({ staleOk: ['docs/a.md'] });
      expect(result.lines[0]).toContain("could not read this change's diff");
      result.record();
      expect(skillRows()[0]).toMatchObject({ scope: 'all-tests', stale_ok: ['docs/a.md'] });
    });

    it('leaves an empty stale list off the row', () => {
      dir = open();
      reviewScript({ ok: true, hash: HASH, scope: 'added' });
      const result = check({ staleOk: [] });
      expect(result.lines).toEqual([]);
      result.record();
      expect(skillRows()[0]).not.toHaveProperty('stale_ok');
    });

    it('writes no row for a recipe with no script, because no output proves it', () => {
      dir = open();
      mkdirSync(join(recipes, 'checks-recipe'), { recursive: true });
      writeFileSync(join(recipes, 'checks-recipe', 'SKILL.md'), 'body');
      const result = check({ stage: 'checks' });
      expect(result.verdict).toBe('pass');
      result.record();
      expect(skillRows()).toEqual([]);
    });
  });
});
