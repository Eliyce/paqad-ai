// Issue #581 — the spec-pipeline flags the bundle-completeness manifest reads, taken from the
// layered config map (src/verification/** must not import the pipeline, FR-11).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSpecPipelineFlags } from '@/verification/repository/run-repository-verification.js';

describe('readSpecPipelineFlags', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-flags-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const config = (lines: string[]) =>
    writeFileSync(join(root, '.paqad', '.config'), `${lines.join('\n')}\n`, 'utf8');

  it('reads every flag off when nothing is set', () => {
    expect(readSpecPipelineFlags(root)).toEqual({ enabled: false, strict: false, experts: false });
  });

  it('reads the pipeline on, strict adoption and experts on', () => {
    config([
      'spec_pipeline_enabled=true',
      'spec_pipeline_adoption=strict',
      'spec_pipeline_experts_enabled=yes',
    ]);
    expect(readSpecPipelineFlags(root)).toEqual({ enabled: true, strict: true, experts: true });
  });

  it('never reads strict with the pipeline off, and keeps experts as set (M5)', () => {
    config(['spec_pipeline_adoption=strict', 'spec_pipeline_experts_enabled=true']);
    expect(readSpecPipelineFlags(root)).toEqual({ enabled: false, strict: false, experts: true });
  });

  it('reads warn adoption as not strict', () => {
    config(['spec_pipeline_enabled=on']);
    expect(readSpecPipelineFlags(root)).toEqual({ enabled: true, strict: false, experts: false });
  });
});
