import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  layeredConfigMap,
  reconcileConfigOverrides,
  writeConfigExample,
} from '@/core/framework-config.js';
import { syncTeamConfigFiles } from '@/core/team-config.js';
import { readPipelineConfig } from '@/spec-pipeline/config.js';
import { readSpecPipelineFlags } from '@/verification/repository/bundle-completeness-config.js';

const SWITCHES = [
  'spec_pipeline_enabled',
  'spec_pipeline_experts_enabled',
  'spec_pipeline_adoption',
] as const;

describe('the spec-pipeline-on defaults never reach a config file (AC-22)', () => {
  let root: string;
  const policy = () => join(root, '.paqad', 'configs', '.config.policy');
  const local = () => join(root, '.paqad', '.config');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sp-defaults-sync-'));
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function runUpdateConfigPath(): void {
    writeConfigExample(root);
    syncTeamConfigFiles(root);
    reconcileConfigOverrides(root);
  }

  it('keeps explicit values byte for byte in the team and local files', () => {
    const team =
      '# team policy\nspec_pipeline_enabled=false\nspec_pipeline_experts_enabled=false\n';
    writeFileSync(policy(), team);
    writeFileSync(local(), 'spec_pipeline_adoption=warn\n');

    runUpdateConfigPath();

    expect(readFileSync(policy(), 'utf8')).toBe(team);
    expect(readFileSync(local(), 'utf8')).toBe('spec_pipeline_adoption=warn\n');
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([false, false, 'warn']);
  });

  it('leaves a project that never set the keys unset, the defaults applying through code', () => {
    const old = '# an older policy file\nstages_mode=strict\n';
    writeFileSync(policy(), old);

    runUpdateConfigPath();

    const after = readFileSync(policy(), 'utf8');
    expect(after).toBe(old);
    for (const key of SWITCHES) {
      expect(after).not.toMatch(new RegExp(`^${key}=`, 'mu'));
      expect(layeredConfigMap(root, {}).has(key)).toBe(false);
    }
    expect(readSpecPipelineFlags(root, {})).toEqual({ enabled: true, strict: true, experts: true });
  });

  it('never reads a stale commented default as a set value, and never rewrites it', () => {
    const stale = [
      '# spec_pipeline_enabled=false',
      '# spec_pipeline_experts_enabled=false',
      '# spec_pipeline_adoption=warn',
      '',
    ].join('\n');
    writeFileSync(policy(), stale);

    runUpdateConfigPath();

    const after = readFileSync(policy(), 'utf8');
    expect(after).toBe(stale);
    for (const key of SWITCHES) {
      expect(after).not.toMatch(new RegExp(`^${key}=`, 'mu'));
      expect(layeredConfigMap(root, {}).has(key)).toBe(false);
    }
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([true, true, 'strict']);
  });
});
