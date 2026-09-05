import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { expertsActive, readPipelineConfig } from '@/spec-pipeline/config.js';

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
  it('defaults: disabled, clarification=warn, final_review=off, ceiling=20000, experts off', () => {
    const cfg = readPipelineConfig(tempRoot(), {});
    expect(cfg).toEqual({
      enabled: false,
      clarification: 'warn',
      final_review: 'off',
      token_ceiling: 20000,
      experts_enabled: false,
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
      ].join('\n'),
    );
    expect(readPipelineConfig(root, {})).toEqual({
      enabled: true,
      clarification: 'strict',
      final_review: 'warn',
      token_ceiling: 5000,
      experts_enabled: true,
    });
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
    expect(cfg.token_ceiling).toBe(20000);
  });
});

describe('expertsActive', () => {
  const base = { clarification: 'warn', final_review: 'off', token_ceiling: 20000 } as const;

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
