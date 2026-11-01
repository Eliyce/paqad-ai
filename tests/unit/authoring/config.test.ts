import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AUTHORING_CONFIG_KEYS,
  authoringConfigProblems,
  readAuthoringConfig,
  agentOrchestratorEnabled,
  skillOrchestratorEnabled,
} from '@/authoring/config.js';
import { generateGroupConfig } from '@/core/framework-config.js';

const roots: string[] = [];

function project(config = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-authoring-config-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', '.config'), config, 'utf8');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const NO_ENV = {} as NodeJS.ProcessEnv;

describe('readAuthoringConfig', () => {
  it('returns the issue defaults when nothing is set', () => {
    expect(readAuthoringConfig(project(), NO_ENV)).toEqual({
      skill_orchestrator_enabled: true,
      authoring_trigger_threshold: 0.9,
      authoring_trigger_min_runs: 2,
      skill_eval_min_gain_points: 10,
      skill_eval_max_token_multiple: 2,
      authoring_runs_per_arm: 3,
      authoring_max_iterations: 3,
      authoring_fact_max_age_days: 60,
      authoring_collision_jaccard: 0.4,
      authoring_description_budget_chars: 8000,
      skill_body_max_tokens: 5000,
      authoring_tool_result_max_tokens: 10000,
      authoring_cache_hit_min: 0.7,
      authoring_regression_tolerance: 0.2,
      authoring_dark_window_days: 30,
      authoring_batch_mode: 'auto',
      authoring_run_max_cost_usd: 5,
      authoring_otel_endpoint: '',
      agent_orchestrator_enabled: true,
      agent_pass_k_threshold: 0.9,
      agent_stage_pass_k_threshold: 0.95,
      agent_delegation_threshold: 0.9,
      agent_description_max_tokens: 300,
      agent_report_max_tokens: 2000,
      agent_prompt_max_tokens: 3000,
      agent_max_tools: 10,
      agent_max_cost_multiple: 4,
      agent_catalog_description_max_tokens: 15000,
      agent_memory_max_lines: 200,
    });
    expect(AUTHORING_CONFIG_KEYS).toHaveLength(29);
  });

  it('reads set values and lets env win over the local file', () => {
    const root = project(
      'authoring_collision_jaccard=0.5\nauthoring_batch_mode=off\nskill_orchestrator_enabled=false\n',
    );
    const config = readAuthoringConfig(root, {
      PAQAD_AUTHORING_MAX_ITERATIONS: '5',
    } as NodeJS.ProcessEnv);
    expect(config.authoring_collision_jaccard).toBe(0.5);
    expect(config.authoring_batch_mode).toBe('off');
    expect(config.authoring_max_iterations).toBe(5);
    expect(config.skill_orchestrator_enabled).toBe(false);
    expect(skillOrchestratorEnabled(root, NO_ENV)).toBe(false);
  });

  it('falls back to the default for an out-of-range value', () => {
    const root = project(
      'authoring_trigger_threshold=1.5\nauthoring_runs_per_arm=2.5\nauthoring_otel_endpoint=ftp://x\n',
    );
    const config = readAuthoringConfig(root, NO_ENV);
    expect(config.authoring_trigger_threshold).toBe(0.9);
    expect(config.authoring_runs_per_arm).toBe(3);
    expect(config.authoring_otel_endpoint).toBe('');
  });
});

describe('authoringConfigProblems', () => {
  it('reports nothing for defaults and for in-range edge values', () => {
    expect(authoringConfigProblems(project(), NO_ENV)).toEqual([]);
    const root = project(
      [
        'authoring_trigger_threshold=0',
        'authoring_collision_jaccard=1',
        'skill_eval_max_token_multiple=1',
        'authoring_run_max_cost_usd=0.01',
        'authoring_otel_endpoint=https://otel.example.test:4318',
        'authoring_trigger_min_runs=1',
      ].join('\n'),
    );
    expect(authoringConfigProblems(root, NO_ENV)).toEqual([]);
  });

  it('AC-41: names the key, the value and the allowed range for each out-of-range value', () => {
    const root = project(
      [
        'skill_orchestrator_enabled=maybe',
        'authoring_trigger_threshold=1.2',
        'authoring_cache_hit_min=-0.1',
        'authoring_fact_max_age_days=0',
        'authoring_dark_window_days=7.5',
        'skill_eval_max_token_multiple=0.5',
        'authoring_batch_mode=sometimes',
        'authoring_run_max_cost_usd=0',
        'authoring_otel_endpoint=not a url',
      ].join('\n'),
    );
    expect(authoringConfigProblems(root, NO_ENV)).toEqual([
      { key: 'skill_orchestrator_enabled', value: 'maybe', allowed: 'true or false' },
      { key: 'authoring_trigger_threshold', value: '1.2', allowed: 'a number from 0 to 1' },
      { key: 'skill_eval_max_token_multiple', value: '0.5', allowed: 'a number of 1 or more' },
      { key: 'authoring_fact_max_age_days', value: '0', allowed: 'a positive whole number' },
      { key: 'authoring_cache_hit_min', value: '-0.1', allowed: 'a number from 0 to 1' },
      { key: 'authoring_dark_window_days', value: '7.5', allowed: 'a positive whole number' },
      { key: 'authoring_batch_mode', value: 'sometimes', allowed: 'auto or off' },
      { key: 'authoring_run_max_cost_usd', value: '0', allowed: 'a number above 0' },
      { key: 'authoring_otel_endpoint', value: 'not a url', allowed: 'empty or an http(s) URL' },
    ]);
  });
});

describe('agent settings', () => {
  it('reads agent_orchestrator_enabled from the local file and the env', () => {
    expect(agentOrchestratorEnabled(project(), NO_ENV)).toBe(true);
    expect(agentOrchestratorEnabled(project('agent_orchestrator_enabled=false\n'), NO_ENV)).toBe(
      false,
    );
    expect(
      agentOrchestratorEnabled(project(), {
        PAQAD_AGENT_ORCHESTRATOR_ENABLED: 'off',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('accepts the edge values of each agent range', () => {
    const root = project(
      [
        'agent_pass_k_threshold=1',
        'agent_stage_pass_k_threshold=0',
        'agent_delegation_threshold=0.5',
        'agent_max_tools=1',
        'agent_max_cost_multiple=1',
        'agent_memory_max_lines=1',
      ].join('\n'),
    );
    expect(authoringConfigProblems(root, NO_ENV)).toEqual([]);
    const config = readAuthoringConfig(root, NO_ENV);
    expect(config.agent_pass_k_threshold).toBe(1);
    expect(config.agent_max_cost_multiple).toBe(1);
  });

  it('warns on an out-of-range agent value and falls back to the default', () => {
    const root = project(
      [
        'agent_pass_k_threshold=1.1',
        'agent_description_max_tokens=0',
        'agent_prompt_max_tokens=12.5',
        'agent_max_cost_multiple=0.9',
        'agent_orchestrator_enabled=perhaps',
      ].join('\n'),
    );
    expect(authoringConfigProblems(root, NO_ENV)).toEqual([
      { key: 'agent_orchestrator_enabled', value: 'perhaps', allowed: 'true or false' },
      { key: 'agent_pass_k_threshold', value: '1.1', allowed: 'a number from 0 to 1' },
      { key: 'agent_description_max_tokens', value: '0', allowed: 'a positive whole number' },
      { key: 'agent_prompt_max_tokens', value: '12.5', allowed: 'a positive whole number' },
      { key: 'agent_max_cost_multiple', value: '0.9', allowed: 'a number of 1 or more' },
    ]);
    const config = readAuthoringConfig(root, NO_ENV);
    expect(config.agent_pass_k_threshold).toBe(0.9);
    expect(config.agent_description_max_tokens).toBe(300);
    expect(config.agent_prompt_max_tokens).toBe(3000);
    expect(config.agent_max_cost_multiple).toBe(4);
    expect(config.agent_orchestrator_enabled).toBe(true);
  });
});

describe('the policy group file', () => {
  it('lists every key commented at its default and round-trips to the defaults', () => {
    const text = generateGroupConfig('policy');
    for (const key of AUTHORING_CONFIG_KEYS) {
      expect(text).toMatch(new RegExp(`^# ${key}=`, 'm'));
    }
    const uncommented = text
      .split('\n')
      .filter((line) => AUTHORING_CONFIG_KEYS.some((key) => line.startsWith(`# ${key}=`)))
      .map((line) => line.slice(2))
      .join('\n');
    const root = project();
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'configs', '.config.policy'), `${uncommented}\n`);
    expect(readAuthoringConfig(root, NO_ENV)).toEqual(readAuthoringConfig(project(), NO_ENV));
    expect(authoringConfigProblems(root, NO_ENV)).toEqual([]);
  });
});
