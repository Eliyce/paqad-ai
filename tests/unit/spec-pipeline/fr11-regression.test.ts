import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fg from 'fast-glob';
import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineConfig } from '@/spec-pipeline/config.js';
import {
  loadFeatureDevelopmentPolicy,
  renderDefaultFeatureDevelopmentPolicyYaml,
} from '@/pipeline/feature-development-policy.js';

// FR-11 (supercritical): with the pipeline switched off, feature-development behaves exactly as
// before the pipeline. Since issue #640 the pipeline is on by default, so "off" now means a
// project set spec_pipeline_enabled=false. It sits UPSTREAM of the edit lock as a separate
// `spec pipeline` command; nothing in the feature-development execution path may reach it, so
// a feature-dev change produces the same bundle artifacts / stage ledger whether or not the
// pipeline exists.
describe('FR-11: a switched-off pipeline never runs in the feature-dev flow', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('is disabled when the project switches it off (independent of any repo override)', () => {
    // Test a temp project, not this repo's own committed config, so the claim is not coupled to
    // the dogfood repo's settings.
    const off = mkdtempSync(join(tmpdir(), 'paqad-fr11-'));
    roots.push(off);
    mkdirSync(join(off, '.paqad'), { recursive: true });
    writeFileSync(join(off, '.paqad', '.config'), 'spec_pipeline_enabled=false\n');
    expect(readPipelineConfig(off, {}).enabled).toBe(false);
  });

  it('is enabled by default when nothing is set (issue #640, code default)', () => {
    const clean = mkdtempSync(join(tmpdir(), 'paqad-fr11-default-'));
    roots.push(clean);
    expect(readPipelineConfig(clean, {}).enabled).toBe(true);
  });

  it('the specification stage text is identical whether the pipeline flag is on or off (AC-1)', () => {
    const off = mkdtempSync(join(tmpdir(), 'paqad-fr11-off-'));
    const on = mkdtempSync(join(tmpdir(), 'paqad-fr11-on-'));
    roots.push(off, on);
    // The ON root actually carries the flags on; the OFF root switches the pipeline off.
    mkdirSync(join(on, '.paqad'), { recursive: true });
    mkdirSync(join(off, '.paqad'), { recursive: true });
    writeFileSync(join(off, '.paqad', '.config'), 'spec_pipeline_enabled=false\n');
    writeFileSync(
      join(on, '.paqad', '.config'),
      ['spec_pipeline_enabled=true', 'spec_pipeline_adoption=strict'].join('\n'),
    );
    const offPolicy = loadFeatureDevelopmentPolicy(off).policy.stages.specification;
    const onPolicy = loadFeatureDevelopmentPolicy(on).policy.stages.specification;
    // The stage instructions do not branch on the flag — the pipeline clause is static.
    expect(onPolicy.instructions).toEqual(offPolicy.instructions);
    // And the clause is present regardless (AC-3, default policy surface).
    expect(offPolicy.instructions.some((i) => i.includes('produce the spec through'))).toBe(true);
  });

  it('the rendered YAML carries the spec-pipeline instruction verbatim (AC-3)', () => {
    const yaml = renderDefaultFeatureDevelopmentPolicyYaml();
    expect(yaml).toContain(
      'Spec pipeline: when `spec_pipeline_enabled` is on, produce the spec through',
    );
    expect(yaml).toContain(
      'spec_pipeline_adoption=strict a hand-written spec is refused at freeze',
    );
  });

  it('no feature-development execution-path module imports the pipeline', () => {
    // The modules the feature-development flow actually executes: stage recording, the
    // verification/completion gates, the enforcement kernel, and prompt routing. None may
    // depend on src/spec-pipeline (only the opt-in `spec pipeline` CLI and `doctor` may).
    const paths = fg.sync(
      [
        'src/stage-evidence/**/*.ts',
        'src/verification/**/*.ts',
        'src/kernel/**/*.ts',
        'src/pipeline/**/*.ts',
      ],
      { cwd: process.cwd(), onlyFiles: true },
    );
    const offenders: string[] = [];
    for (const rel of paths) {
      const src = readFileSync(rel, 'utf8');
      if (/from ['"][^'"]*spec-pipeline/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
