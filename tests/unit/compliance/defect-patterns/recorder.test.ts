import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { recordFromComplianceReport } from '@/compliance/defect-patterns/recorder.js';
import { loadIndex } from '@/compliance/defect-patterns/store.js';
import type { ComplianceReport } from '@/compliance/types.js';

function makeReport(
  obligationStates: Array<{ id: string; state: string; description: string }>,
): ComplianceReport {
  return {
    metadata: {
      spec_file: 'docs/spec.md',
      spec_hash: 'hash',
      generated_at: new Date().toISOString(),
      schema_version: 1,
      test_files_hash: 'testhash',
      cache_hit: false,
    },
    summary: {
      total: obligationStates.length,
      covered: 0,
      partial: 0,
      uncovered: obligationStates.filter((o) => o.state === 'uncovered').length,
      indeterminate: 0,
      compliance_ratio: 0,
    },
    spec_review: null,
    obligations: obligationStates.map((o) => ({
      obligation_id: o.id,
      category: 'functional' as const,
      description: o.description,
      pass_criteria: null,
      source_section: 'Spec',
      source_line: 1,
      spec_file: 'docs/spec.md',
      state: o.state as 'uncovered' | 'covered',
      evidence: [],
    })),
    uncovered_obligations: obligationStates.filter((o) => o.state === 'uncovered').map((o) => o.id),
  };
}

describe('recordFromComplianceReport', () => {
  it('records uncovered obligations and returns the count (FR-DP1-T1)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-rec-'));
    const report = makeReport([
      { id: 'FR-1-T1', state: 'uncovered', description: 'CLI must expose compliance report' },
      { id: 'FR-1-T2', state: 'uncovered', description: 'Error handling for parse failure' },
      { id: 'FR-1-T3', state: 'covered', description: 'Covered obligation' },
    ]);

    const count = await recordFromComplianceReport({ report, storeRoot: root });

    expect(count).toBe(2);
    const index = await loadIndex(root);
    expect(index.entries).toHaveLength(2);
  });

  it('returns 0 and does not write when all obligations are covered', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-rec-'));
    const report = makeReport([{ id: 'FR-1-T1', state: 'covered', description: 'Covered' }]);

    const count = await recordFromComplianceReport({ report, storeRoot: root });

    expect(count).toBe(0);
    const index = await loadIndex(root);
    expect(index.entries).toHaveLength(0);
  });

  it('uses the provided stack context when supplied', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-rec-'));
    const report = makeReport([
      { id: 'FR-1-T1', state: 'uncovered', description: 'CLI flag missing' },
    ]);

    await recordFromComplianceReport({
      report,
      stack_context: { frameworks: ['go'], traits: ['api'] },
      storeRoot: root,
    });

    const { loadEntry } = await import('@/compliance/defect-patterns/store.js');
    const index = await loadIndex(root);
    const entry = await loadEntry(index.entries[0]!.pattern_id, root);
    expect(entry!.stack_contexts[0]!.frameworks).toContain('go');
  });

  it('falls back to empty stack context when none is provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-rec-'));
    const report = makeReport([
      { id: 'FR-1-T1', state: 'uncovered', description: 'Boundary condition missing' },
    ]);

    await recordFromComplianceReport({ report, storeRoot: root });

    const { loadEntry } = await import('@/compliance/defect-patterns/store.js');
    const index = await loadIndex(root);
    const entry = await loadEntry(index.entries[0]!.pattern_id, root);
    expect(entry!.stack_contexts[0]!.frameworks).toEqual([]);
  });
});
