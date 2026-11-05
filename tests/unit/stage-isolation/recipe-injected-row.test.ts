import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { recordRecipeInjected } from '@/stage-isolation/stage-brief.js';

const SESSION = 'ses_injected';
const INJECTED = {
  recipe: 'review-recipe',
  recipe_hash: 'b'.repeat(64),
  recipe_root: '/root',
  truncated: false,
};

describe('recording that a recipe reached a stage agent', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-recipe-injected-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const open = () =>
    openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'Injected',
      issue: '1',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYB0',
      lane: 'full',
    });
  const record = (agentId: unknown, injected = INJECTED) =>
    recordRecipeInjected(root, 'review', { session_id: SESSION, agent_id: agentId }, injected, {});
  const injectedRows = (dir: string) =>
    readFeatureStageUnit(root, dir).filter((row) => row.kind === 'recipe-injected');

  it('reports false when no change is active', () => {
    expect(record('a1')).toBe(false);
  });

  it('writes one row per agent, and a resumed agent does not write a second', () => {
    const dir = open();
    expect(record('a1')).toBe(true);
    expect(record('a1')).toBe(true);
    expect(record('a2')).toBe(true);
    expect(injectedRows(dir).map((row) => row.agent_id)).toEqual(['a1', 'a2']);
    expect(injectedRows(dir)[0]).toMatchObject({ agent: 'paqad-review', recipe: 'review-recipe' });
    expect(injectedRows(dir)[0]).not.toHaveProperty('truncated');
  });

  it('writes again when the recipe text changed', () => {
    const dir = open();
    record('a1');
    record('a1', { ...INJECTED, recipe_hash: 'c'.repeat(64) });
    expect(injectedRows(dir)).toHaveLength(2);
  });

  it('marks a recipe cut to fit', () => {
    const dir = open();
    record('a1', { ...INJECTED, truncated: true });
    expect(injectedRows(dir)[0]).toMatchObject({ truncated: true });
  });

  it('writes with no agent id for a host that gave none, every time', () => {
    const dir = open();
    record(undefined, { ...INJECTED, recipe_hash: 'd'.repeat(64) });
    expect(injectedRows(dir)).toHaveLength(1);
    expect(injectedRows(dir)[0]).not.toHaveProperty('agent_id');
  });
});
