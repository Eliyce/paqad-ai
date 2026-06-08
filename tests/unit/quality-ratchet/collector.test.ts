import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROJECT_SCOPE } from '@/core/types/quality-ratchet.js';
import {
  collectQualityMeasures,
  type CollectQualityMeasuresOptions,
  type MeasureRunResult,
} from '@/quality-ratchet/collector.js';

function project(strict = true): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-collector-'));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict } }));
  mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  writeFileSync(
    join(root, 'docs/instructions/rules/module-map.yml'),
    `version: 2
modules:
  - slug: core
    sources:
      - src/core/**
`,
  );
  return root;
}

function baseOptions(root: string): CollectQualityMeasuresOptions {
  return {
    projectRoot: root,
    changedFiles: [],
    lane: 'full',
    stackProfile: null,
    deadCodeFiles: [],
  };
}

function find(
  samples: Awaited<ReturnType<typeof collectQualityMeasures>>,
  measure: string,
  module: string,
) {
  return samples.find((s) => s.measure === measure && s.module === module);
}

describe('collectQualityMeasures', () => {
  it('collects only strictness on the fast lane (no measure noise)', async () => {
    const samples = await collectQualityMeasures({ ...baseOptions(project()), lane: 'fast' });
    expect(samples).toHaveLength(1);
    expect(samples[0]?.measure).toBe('strictness');
    expect(samples[0]?.value).toBe(7);
    expect(samples[0]?.tool).toBe('tsconfig');
  });

  it('records strictness as blocked when there is no tsconfig', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-collector-nots-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/rules/module-map.yml'),
      'version: 2\nmodules: []\n',
    );
    const samples = await collectQualityMeasures({ ...baseOptions(root), lane: 'fast' });
    expect(find(samples, 'strictness', PROJECT_SCOPE)?.value).toBeNull();
    expect(find(samples, 'strictness', PROJECT_SCOPE)?.blocked_reason).toBe(
      'no-tsconfig-or-unparseable',
    );
  });

  it('consumes the #109 orphan set and attributes it to modules + project', async () => {
    const root = project();
    const samples = await collectQualityMeasures({
      ...baseOptions(root),
      deadCodeFiles: ['src/core/a.ts', 'src/core/b.ts', 'src/other/c.ts'],
    });
    expect(find(samples, 'dead_code', PROJECT_SCOPE)?.value).toBe(3);
    expect(find(samples, 'dead_code', 'core')?.value).toBe(2);
    expect(find(samples, 'dead_code', PROJECT_SCOPE)?.tool).toBe('traceability-reachability');
  });

  it('records dead_code as blocked when the traceability map is unavailable', async () => {
    const samples = await collectQualityMeasures({
      ...baseOptions(project()),
      deadCodeFiles: null,
    });
    expect(find(samples, 'dead_code', PROJECT_SCOPE)?.value).toBeNull();
    expect(find(samples, 'dead_code', PROJECT_SCOPE)?.blocked_reason).toBe(
      'traceability-map-unavailable',
    );
  });

  it('marks tangledness and risky_patterns blocked when no runner is wired', async () => {
    const samples = await collectQualityMeasures(baseOptions(project()));
    expect(find(samples, 'tangledness', PROJECT_SCOPE)?.value).toBeNull();
    expect(find(samples, 'tangledness', PROJECT_SCOPE)?.confidence).toBe('lower');
    expect(find(samples, 'risky_patterns', PROJECT_SCOPE)?.blocked_reason).toBe('tool-not-wired');
  });

  it('rolls up an injected tangledness runner result', async () => {
    const root = project();
    const result: MeasureRunResult = {
      tool: 'eslint-complexity',
      confidence: 'mature',
      files: [
        { file: 'src/core/x.ts', count: 3 },
        { file: 'src/core/y.ts', count: 1 },
      ],
    };
    const samples = await collectQualityMeasures({
      ...baseOptions(root),
      deps: { collectTangledness: async () => result },
    });
    expect(find(samples, 'tangledness', PROJECT_SCOPE)?.value).toBe(4);
    expect(find(samples, 'tangledness', 'core')?.value).toBe(4);
    expect(find(samples, 'tangledness', PROJECT_SCOPE)?.tool).toBe('eslint-complexity');
  });

  it('treats a runner that throws as no signal (blocked, not a crash)', async () => {
    const samples = await collectQualityMeasures({
      ...baseOptions(project()),
      deps: {
        collectRiskyPatterns: async () => {
          throw new Error('tool exploded');
        },
      },
    });
    expect(find(samples, 'risky_patterns', PROJECT_SCOPE)?.value).toBeNull();
  });
});
