import { readFileSync } from 'node:fs';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

import { readPipelineConfig } from '@/spec-pipeline/config.js';

// FR-11 (supercritical): with the pipeline disabled (the default), feature-development behaves
// exactly as today. The pipeline is opt-in and sits UPSTREAM of the edit lock as a separate
// `spec pipeline` command; nothing in the feature-development execution path may reach it, so
// a feature-dev change produces the same bundle artifacts / stage ledger whether or not the
// pipeline exists.
describe('FR-11: pipeline is off by default and never runs in the feature-dev flow', () => {
  it('is disabled by default', () => {
    const cfg = readPipelineConfig(process.cwd(), {});
    // The repo itself sets no spec_pipeline_enabled, so the default (false) holds.
    expect(cfg.enabled).toBe(false);
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
