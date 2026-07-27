import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyBaselineStatus,
  baselinePath,
  readBaseline,
  writeBaseline,
} from '@/site-map/baseline.js';
import type { SiteMapBaseline, SiteMapFinding } from '@/core/types/site-map-run.js';

function finding(id: string): SiteMapFinding {
  return {
    id,
    title: 't',
    description: 'd',
    category: 'SM-ADD',
    severity: 'low',
    tier: 'deterministic',
    confidence: 1,
    evidence: [],
    resolution: 'do the thing',
    affected_surfaces: [],
    affected_files: [],
    baseline_status: 'unknown',
    status: 'open',
  };
}

describe('site-map baseline', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-baseline-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads null when no baseline exists', () => {
    expect(readBaseline(root)).toBeNull();
  });

  it('reads null when the baseline is corrupt', () => {
    const target = baselinePath(root);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '{ not json', 'utf8');
    expect(readBaseline(root)).toBeNull();
  });

  it('reads null when finding_ids is not an array', () => {
    const target = baselinePath(root);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ finding_ids: 'nope' }), 'utf8');
    expect(readBaseline(root)).toBeNull();
  });

  it('writes a sorted baseline and reads it back', async () => {
    const written = await writeBaseline(root, ['SM-C', 'SM-A', 'SM-B'], new Date(2026, 0, 1));
    expect(written.finding_ids).toEqual(['SM-A', 'SM-B', 'SM-C']);
    const read = readBaseline(root);
    expect(read).not.toBeNull();
    expect((read as SiteMapBaseline).finding_ids).toEqual(['SM-A', 'SM-B', 'SM-C']);
  });

  describe('applyBaselineStatus', () => {
    it('marks every finding unknown when there is no baseline', () => {
      const result = applyBaselineStatus([finding('SM-1')], null);
      expect(result[0]!.baseline_status).toBe('unknown');
    });

    it('splits pre-existing from new-since-baseline against a baseline', () => {
      const baseline: SiteMapBaseline = {
        schema_version: '1',
        generated_by: 'paqad-ai',
        framework_version: '0.0.0',
        created_at: '2026-01-01T00:00:00.000Z',
        finding_ids: ['SM-1'],
      };
      const result = applyBaselineStatus([finding('SM-1'), finding('SM-2')], baseline);
      expect(result[0]!.baseline_status).toBe('pre-existing');
      expect(result[1]!.baseline_status).toBe('new-since-baseline');
    });
  });
});
