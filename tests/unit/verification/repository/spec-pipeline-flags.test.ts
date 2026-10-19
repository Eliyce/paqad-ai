// Issue #581 — the spec-pipeline flags the bundle-completeness manifest reads, taken from the
// layered config map (src/verification/** must not import the pipeline, FR-11). Issue #640 made
// the pipeline, the experts and strict adoption the defaults for an unset key.
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
  const teamPolicy = (lines: string[]) => {
    mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'configs', '.config.policy'), `${lines.join('\n')}\n`);
  };

  it('reads every flag at its default (on, strict, experts on) when nothing is set (AC-16)', () => {
    expect(readSpecPipelineFlags(root, {})).toEqual({ enabled: true, strict: true, experts: true });
  });

  it('reads every flag off when each is switched off explicitly', () => {
    config([
      'spec_pipeline_enabled=false',
      'spec_pipeline_adoption=warn',
      'spec_pipeline_experts_enabled=false',
    ]);
    expect(readSpecPipelineFlags(root, {})).toEqual({
      enabled: false,
      strict: false,
      experts: false,
    });
  });

  it('reads the pipeline on, strict adoption and experts on', () => {
    config([
      'spec_pipeline_enabled=true',
      'spec_pipeline_adoption=strict',
      'spec_pipeline_experts_enabled=yes',
    ]);
    expect(readSpecPipelineFlags(root, {})).toEqual({ enabled: true, strict: true, experts: true });
  });

  it('never reads strict with the pipeline off, and keeps experts as set (M5)', () => {
    config(['spec_pipeline_enabled=off', 'spec_pipeline_experts_enabled=true']);
    expect(readSpecPipelineFlags(root, {})).toEqual({
      enabled: false,
      strict: false,
      experts: true,
    });
  });

  it('reads warn adoption as not strict, the other keys at their defaults (AC-18)', () => {
    config(['spec_pipeline_adoption=warn']);
    expect(readSpecPipelineFlags(root, {})).toEqual({
      enabled: true,
      strict: false,
      experts: true,
    });
  });

  it('reads the pipeline off from the team policy file, the rest unchanged (AC-17)', () => {
    teamPolicy(['spec_pipeline_enabled=false']);
    expect(readSpecPipelineFlags(root, {})).toEqual({
      enabled: false,
      strict: false,
      experts: true,
    });
  });

  it('lets the env switch win over every config file (AC-19)', () => {
    teamPolicy(['spec_pipeline_enabled=true']);
    config(['spec_pipeline_enabled=true']);
    expect(readSpecPipelineFlags(root, { PAQAD_SPEC_PIPELINE_ENABLED: '0' })).toEqual({
      enabled: false,
      strict: false,
      experts: true,
    });
  });

  it('degrades an unrecognised value to the default (RULE-16)', () => {
    config(['spec_pipeline_enabled=maybe', 'spec_pipeline_adoption=STRICT']);
    expect(readSpecPipelineFlags(root, {})).toEqual({ enabled: true, strict: true, experts: true });
  });
});
