import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fg from 'fast-glob';
import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineConfig } from '@/spec-pipeline/config.js';

// FR-11 (supercritical): with the pipeline disabled (the default), feature-development behaves
// exactly as today. The pipeline is opt-in and sits UPSTREAM of the edit lock as a separate
// `spec pipeline` command; nothing in the feature-development execution path may reach it, so
// a feature-dev change produces the same bundle artifacts / stage ledger whether or not the
// pipeline exists.
describe('FR-11: pipeline is off by default and never runs in the feature-dev flow', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('is disabled by default (code default, independent of any repo override)', () => {
    // Test the CODE default, not this repo's own committed config: a project that sets no
    // spec_pipeline_enabled must read false. Reading process.cwd() here would instead assert
    // "the dogfood repo carries no override", which is a different (and repo-coupled) claim —
    // a project may deliberately opt in without weakening the off-by-default guarantee.
    const clean = mkdtempSync(join(tmpdir(), 'paqad-fr11-'));
    roots.push(clean);
    const cfg = readPipelineConfig(clean, {});
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
