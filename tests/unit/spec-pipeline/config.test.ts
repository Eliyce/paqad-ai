import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineConfig } from '@/spec-pipeline/config.js';

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
  it('defaults: disabled, clarification=warn, final_review=off, ceiling=20000', () => {
    const cfg = readPipelineConfig(tempRoot(), {});
    expect(cfg).toEqual({
      enabled: false,
      clarification: 'warn',
      final_review: 'off',
      token_ceiling: 20000,
    });
  });

  it('reads enabled + gate modes + ceiling from the local config', () => {
    const root = tempRoot();
    writeLocalConfig(
      root,
      [
        'spec_pipeline_enabled=true',
        'spec_pipeline_clarification=strict',
        'spec_pipeline_final_review=warn',
        'spec_pipeline_token_ceiling=5000',
      ].join('\n'),
    );
    expect(readPipelineConfig(root, {})).toEqual({
      enabled: true,
      clarification: 'strict',
      final_review: 'warn',
      token_ceiling: 5000,
    });
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
