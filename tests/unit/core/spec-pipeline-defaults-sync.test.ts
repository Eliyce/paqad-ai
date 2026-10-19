// Issue #640 (AC-22, INV-17) — turning the spec pipeline, the experts and strict adoption on by
// default must never touch a config file. `paqad-ai update` refreshes the team config layer with
// writeConfigExample, syncGroupConfigs and reconcileConfigOverrides (src/update/updater.ts); a
// value a project set must survive that byte for byte, a key it never set must stay unset (the
// new default applies through code), and a commented-out line is never a set value.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  generateGroupConfig,
  layeredConfigMap,
  reconcileConfigOverrides,
  syncGroupConfigs,
  writeConfigExample,
} from '@/core/framework-config.js';
import { readPipelineConfig } from '@/spec-pipeline/config.js';
import { readSpecPipelineFlags } from '@/verification/repository/bundle-completeness-config.js';

const SWITCHES = [
  'spec_pipeline_enabled',
  'spec_pipeline_experts_enabled',
  'spec_pipeline_adoption',
] as const;

describe('the #640 defaults never reach a config file (AC-22)', () => {
  let root: string;
  const policy = () => join(root, '.paqad', 'configs', '.config.policy');
  const local = () => join(root, '.paqad', '.config');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sp-defaults-sync-'));
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** The config half of `paqad-ai update`, in the updater's order. */
  function runUpdateConfigPath(): void {
    writeConfigExample(root);
    syncGroupConfigs(root);
    reconcileConfigOverrides(root);
  }

  it('keeps explicit values byte for byte in the team and local files', () => {
    const team = generateGroupConfig(
      'policy',
      new Map([
        ['spec_pipeline_enabled', 'false'],
        ['spec_pipeline_experts_enabled', 'false'],
      ]),
    );
    writeFileSync(policy(), team);
    writeFileSync(local(), 'spec_pipeline_adoption=warn\n');

    runUpdateConfigPath();

    expect(readFileSync(policy(), 'utf8')).toBe(team);
    expect(readFileSync(local(), 'utf8')).toBe('spec_pipeline_adoption=warn\n');
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([false, false, 'warn']);
  });

  it('leaves a project that never set the keys unset, the defaults applying through code', () => {
    // A team file from before the spec pipeline existed: it knows none of the keys.
    const old = '# an older policy file\nstages_mode=strict\n';
    writeFileSync(policy(), old);

    runUpdateConfigPath();

    const after = readFileSync(policy(), 'utf8');
    // The team's lines are untouched; the new keys are only appended as managed comments.
    expect(after.startsWith(old.trimEnd())).toBe(true);
    for (const key of SWITCHES) {
      expect(after).toMatch(new RegExp(`^# ${key}=`, 'mu'));
      expect(after).not.toMatch(new RegExp(`^${key}=`, 'mu'));
      expect(layeredConfigMap(root, {}).has(key)).toBe(false);
    }
    expect(readSpecPipelineFlags(root, {})).toEqual({ enabled: true, strict: true, experts: true });
  });

  it('never reads a stale commented default as a set value, and never rewrites it', () => {
    // A team file written by an older paqad: every key commented at the OLD default.
    const stale = [
      '# spec_pipeline_enabled=false',
      '# spec_pipeline_experts_enabled=false',
      '# spec_pipeline_adoption=warn',
      '',
    ].join('\n');
    writeFileSync(policy(), stale);

    runUpdateConfigPath();

    const after = readFileSync(policy(), 'utf8');
    expect(after.startsWith(stale.trimEnd())).toBe(true);
    for (const key of SWITCHES) {
      expect(after).not.toMatch(new RegExp(`^${key}=`, 'mu'));
      expect(layeredConfigMap(root, {}).has(key)).toBe(false);
    }
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([true, true, 'strict']);
  });
});
