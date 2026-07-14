import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { HealthBaseline, HealthFinding } from '@/core/types/codebase-health.js';
import {
  applyBaselineStatus,
  baselinePath,
  readBaseline,
  writeBaseline,
} from '@/codebase-health/baseline.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'hl-baseline-'));
}

function finding(id: string): HealthFinding {
  return {
    id,
    title: 't',
    description: 'd',
    category: 'dead-code',
    severity: 'low',
    tier: 'deterministic',
    confidence: 0.9,
    evidence: [],
    suggestion: { action: 'remove', detail: 'x' },
    affected_files: [],
    affected_packages: [],
    requires_network: false,
    baseline_status: 'unknown',
    status: 'open',
  };
}

describe('readBaseline', () => {
  it('returns null when absent', () => {
    expect(readBaseline(repo())).toBeNull();
  });

  it('returns null on corrupt or wrong-shape JSON', () => {
    const root = repo();
    mkdirSync(join(root, PATHS.HEALTH_ROOT_DIR), { recursive: true });
    writeFileSync(join(root, PATHS.HEALTH_BASELINE), 'not json');
    expect(readBaseline(root)).toBeNull();
    writeFileSync(join(root, PATHS.HEALTH_BASELINE), JSON.stringify({ finding_ids: 'nope' }));
    expect(readBaseline(root)).toBeNull();
  });

  it('round-trips a written baseline', async () => {
    const root = repo();
    await writeBaseline(root, ['HL-2', 'HL-1'], new Date(2026, 0, 1));
    const loaded = readBaseline(root) as HealthBaseline;
    expect(loaded.finding_ids).toEqual(['HL-1', 'HL-2']); // sorted
    expect(loaded.generated_by).toBe('paqad-ai');
    expect(baselinePath(root)).toContain(PATHS.HEALTH_BASELINE);
    expect(readFileSync(join(root, PATHS.HEALTH_BASELINE), 'utf8').endsWith('\n')).toBe(true);
  });
});

describe('applyBaselineStatus', () => {
  it('marks all unknown when there is no baseline', () => {
    const out = applyBaselineStatus([finding('HL-1')], null);
    expect(out[0]!.baseline_status).toBe('unknown');
  });

  it('splits new-since-baseline vs pre-existing against a baseline', () => {
    const baseline: HealthBaseline = {
      schema_version: '1',
      generated_by: 'paqad-ai',
      framework_version: '1',
      created_at: 'x',
      finding_ids: ['HL-1'],
    };
    const out = applyBaselineStatus([finding('HL-1'), finding('HL-2')], baseline);
    expect(out[0]!.baseline_status).toBe('pre-existing');
    expect(out[1]!.baseline_status).toBe('new-since-baseline');
  });
});
