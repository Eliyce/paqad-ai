import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { expertsActive, readPipelineConfig, type PipelineConfig } from '@/spec-pipeline/config.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-sp-config-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeLocalConfig(root: string, body: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', '.config'), body, 'utf8');
}

describe('readPipelineConfig', () => {
  it('defaults: enabled, clarification=warn, final_review=off, ceiling=40000, experts on, strict (#640)', () => {
    const cfg = readPipelineConfig(tempRoot(), {});
    expect(cfg).toEqual({
      enabled: true,
      clarification: 'warn',
      final_review: 'off',
      token_ceiling: 40000,
      experts_enabled: true,
      adoption: 'strict',
      standing_experts: [
        'product-owner',
        'application-architect',
        'user-flow-writer',
        'qa-engineer',
      ],
      standing_experts_dropped: [],
    });
  });

  it('reads enabled + gate modes + ceiling + experts from the local config', () => {
    const root = tempRoot();
    writeLocalConfig(
      root,
      [
        'spec_pipeline_enabled=true',
        'spec_pipeline_clarification=strict',
        'spec_pipeline_final_review=warn',
        'spec_pipeline_token_ceiling=5000',
        'spec_pipeline_experts_enabled=on',
        'spec_pipeline_adoption=strict',
        'spec_pipeline_standing_experts=qa-engineer,product-owner',
      ].join('\n'),
    );
    expect(readPipelineConfig(root, {})).toEqual({
      enabled: true,
      clarification: 'strict',
      final_review: 'warn',
      token_ceiling: 5000,
      experts_enabled: true,
      adoption: 'strict',
      standing_experts: ['qa-engineer', 'product-owner'],
      standing_experts_dropped: [],
    });
  });

  it('reads spec_pipeline_adoption (default strict; garbage degrades to strict — RULE-16)', () => {
    const root = tempRoot();
    writeLocalConfig(root, 'spec_pipeline_adoption=banana');
    expect(readPipelineConfig(root, {}).adoption).toBe('strict');
    expect(readPipelineConfig(root, { PAQAD_SPEC_PIPELINE_ADOPTION: 'warn' }).adoption).toBe(
      'warn',
    );
  });

  it('switches everything off when the keys are set off explicitly', () => {
    const root = tempRoot();
    writeLocalConfig(
      root,
      [
        'spec_pipeline_enabled=false',
        'spec_pipeline_experts_enabled=no',
        'spec_pipeline_adoption=warn',
      ].join('\n'),
    );
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([false, false, 'warn']);
  });

  it('reads the pipeline off from the team policy file, the rest unchanged (AC-17)', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'configs', '.config.policy'),
      'spec_pipeline_enabled=false\n',
    );
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([false, true, 'strict']);
  });

  it('keeps the pipeline and experts on with only adoption set to warn (AC-18)', () => {
    const root = tempRoot();
    writeLocalConfig(root, 'spec_pipeline_adoption=warn');
    const cfg = readPipelineConfig(root, {});
    expect([cfg.enabled, cfg.experts_enabled, cfg.adoption]).toEqual([true, true, 'warn']);
  });

  it('lets PAQAD_SPEC_PIPELINE_ENABLED=0 win over every config file (AC-19)', () => {
    const root = tempRoot();
    writeLocalConfig(root, 'spec_pipeline_enabled=true');
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'configs', '.config.policy'),
      'spec_pipeline_enabled=true\n',
    );
    expect(readPipelineConfig(root, { PAQAD_SPEC_PIPELINE_ENABLED: '0' }).enabled).toBe(false);
  });

  it('the PAQAD_ env escape hatch drives experts_enabled too', () => {
    const root = tempRoot();
    writeLocalConfig(root, 'spec_pipeline_experts_enabled=false');
    expect(
      readPipelineConfig(root, { PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED: 'true' }).experts_enabled,
    ).toBe(true);
  });

  it('the PAQAD_ env escape hatch wins over the file', () => {
    const root = tempRoot();
    writeLocalConfig(root, 'spec_pipeline_enabled=false');
    expect(readPipelineConfig(root, { PAQAD_SPEC_PIPELINE_ENABLED: 'yes' }).enabled).toBe(true);
  });

  it('falls back to defaults on garbage values (RULE-16)', () => {
    const root = tempRoot();
    writeLocalConfig(
      root,
      ['spec_pipeline_clarification=banana', 'spec_pipeline_token_ceiling=-3'].join('\n'),
    );
    const cfg = readPipelineConfig(root, {});
    expect(cfg.clarification).toBe('warn');
    expect(cfg.token_ceiling).toBe(40000);
  });

  it('standing_experts: empty knob means none; unknown ids are dropped; deduped (issue #558)', () => {
    const empty = tempRoot();
    writeLocalConfig(empty, 'spec_pipeline_standing_experts=');
    expect(readPipelineConfig(empty, {}).standing_experts).toEqual([]);

    const dropped = tempRoot();
    writeLocalConfig(
      dropped,
      'spec_pipeline_standing_experts=qa-engineer,not-a-role,qa-engineer,chief-architect',
    );
    const cfg = readPipelineConfig(dropped, {});
    expect(cfg.standing_experts).toEqual(['qa-engineer']);
    expect(cfg.standing_experts_dropped).toEqual(['not-a-role', 'chief-architect']);
  });
});

describe('expertsActive', () => {
  const base: Omit<PipelineConfig, 'enabled' | 'experts_enabled'> = {
    clarification: 'warn',
    final_review: 'off',
    token_ceiling: 40000,
    adoption: 'warn',
    standing_experts: [],
    standing_experts_dropped: [],
  };

  it('is true only when the pipeline AND the experts flag are both on (P2-INV-1)', () => {
    expect(expertsActive({ ...base, enabled: true, experts_enabled: true })).toBe(true);
  });

  it('is false when experts is on but the pipeline itself is off', () => {
    expect(expertsActive({ ...base, enabled: false, experts_enabled: true })).toBe(false);
  });

  it('is false when the pipeline is on but experts is off', () => {
    expect(expertsActive({ ...base, enabled: true, experts_enabled: false })).toBe(false);
  });
});
