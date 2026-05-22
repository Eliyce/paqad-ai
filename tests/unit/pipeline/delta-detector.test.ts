import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectDeltaCandidate } from '@/pipeline/delta-detector.js';

describe('detectDeltaCandidate', () => {
  it('returns empty defaults for no affected modules', async () => {
    expect(await detectDeltaCandidate(mkdtempSync(join(tmpdir(), 'paqad-delta-')), [])).toEqual({
      delta_candidate: false,
      base_manifest_slug: null,
      prior_requirement_count: null,
      prior_criterion_count: null,
    });
  });

  it('detects overlapping manifests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-delta-'));
    mkdirSync(join(root, '.paqad/specs'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/specs/base.yaml'),
      [
        'plan_version: 1',
        'plan_mode: full',
        'feature_id: base',
        'slug: base',
        'created_at: 2026-04-10T00:00:00.000Z',
        'base_manifest_hash: null',
        'classification:',
        '  workflow: feature-development',
        '  complexity: medium',
        '  risk: low',
        '  lane: graduated',
        '  domain: coding',
        '  stack: react',
        '  affected_modules:',
        '    - src/a',
        '    - src/b',
        'requirement_graph: []',
        'execution_slices: []',
        'verification_matrix: []',
        'decision_log: []',
        'doc_targets: []',
        'regression_watch: []',
      ].join('\n'),
    );

    const result = await detectDeltaCandidate(root, ['src/a', 'src/b']);
    expect(result.delta_candidate).toBe(true);
    expect(result.base_manifest_slug).toBe('base');
  });

  it('ignores corrupt manifests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-delta-'));
    mkdirSync(join(root, '.paqad/specs'), { recursive: true });
    writeFileSync(join(root, '.paqad/specs/bad.yaml'), 'not: [valid');
    const result = await detectDeltaCandidate(root, ['src/a']);
    expect(result.delta_candidate).toBe(false);
  });
});
