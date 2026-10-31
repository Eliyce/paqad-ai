import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { chooseEvalAdapter, evalTiers, selectEvalAdapter } from '@/authoring/eval/adapters.js';
import { CLAUDE_PLUGIN_EVAL_SUPPORT } from '@/authoring/lint/fields.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(adapter: string, config = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-eval-adapter-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/onboarding-manifest.json'), JSON.stringify({ adapter }));
  writeFileSync(join(root, '.paqad/.config'), config);
  return root;
}

describe('the eval adapter', () => {
  it('uses claude plugin eval on Claude Code 2.1.269 or later', () => {
    expect(selectEvalAdapter({ host: 'claude-code', claudeVersion: '2.1.269' }).adapter).toBe(
      'claude-plugin-eval',
    );
    expect(selectEvalAdapter({ host: 'claude-code', claudeVersion: '2.2.0' }).adapter).toBe(
      'claude-plugin-eval',
    );
  });

  it('falls back to subagent dispatch on older or unreadable Claude Code, and on Codex', () => {
    expect(selectEvalAdapter({ host: 'claude-code', claudeVersion: '2.1.268' })).toMatchObject({
      adapter: 'subagent-dispatch',
      reason: 'Claude Code 2.1.268 is older than 2.1.269',
    });
    expect(selectEvalAdapter({ host: 'claude-code', claudeVersion: null }).reason).toBe(
      'the installed Claude Code version could not be read',
    );
    expect(selectEvalAdapter({ host: 'codex-cli', claudeVersion: null }).adapter).toBe(
      'subagent-dispatch',
    );
  });

  it('EC-01: picks none on a host without subagents', () => {
    expect(selectEvalAdapter({ host: 'gemini-cli', claudeVersion: null }).adapter).toBe('none');
  });

  it('reads the host from the manifest and probes the claude version only on Claude Code', () => {
    let probed = 0;
    const probe = () => {
      probed += 1;
      return '2.1.300';
    };
    expect(chooseEvalAdapter(project('claude-code'), probe).adapter).toBe('claude-plugin-eval');
    expect(chooseEvalAdapter(project('codex-cli'), probe).adapter).toBe('subagent-dispatch');
    expect(probed).toBe(1);
  });

  it("uses the project's fast and reasoning models", () => {
    const tiers = evalTiers(project('claude-code', 'model_fast=haiku-x\nmodel_reasoning=opus-y\n'));
    expect(tiers).toEqual([
      { tier: 'fast', model: 'haiku-x' },
      { tier: 'reasoning', model: 'opus-y' },
    ]);
  });

  it('NFR-13: the plugin-eval support constant was rechecked in the last 60 days', () => {
    const checked = Date.parse(`${CLAUDE_PLUGIN_EVAL_SUPPORT.checked}T00:00:00Z`);
    const ageDays = Math.floor((Date.now() - checked) / 86_400_000);
    expect(
      ageDays,
      `CLAUDE_PLUGIN_EVAL_SUPPORT was checked ${ageDays} days ago. Recheck the floor and flags at ` +
        `${CLAUDE_PLUGIN_EVAL_SUPPORT.source}, then set CLAUDE_PLUGIN_EVAL_SUPPORT.checked in ` +
        'src/authoring/lint/fields.ts to that date.',
    ).toBeLessThanOrEqual(60);
  });
});
