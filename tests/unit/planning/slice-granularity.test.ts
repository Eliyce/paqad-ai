import { describe, expect, it } from 'vitest';

import { checkSliceGranularity } from '@/planning/slice-granularity.js';
import type { VerificationCriterion } from '@/core/types/planning.js';

import { createManifest } from './fixtures.js';

function criterion(id: string): VerificationCriterion {
  return {
    criterion_id: id,
    given: 'g',
    when: 'w',
    then: 't',
    proof_type: 'manual',
    status: 'uncovered',
    source: 'planned',
    linked_requirement_ids: ['FR-1'],
  };
}

describe('checkSliceGranularity', () => {
  it('accepts the default unit of one acceptance criterion per slice', () => {
    const report = checkSliceGranularity(createManifest());
    expect(report).toEqual({ ok: true, findings: [] });
  });

  it('flags a slice that proves no acceptance criterion as below the floor', () => {
    const manifest = createManifest({
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          covers: ['FR-1'],
        },
      ],
    });

    const report = checkSliceGranularity(manifest);
    expect(report.ok).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ slice_id: 'SL-1', code: 'below-floor' });
  });

  it('flags a slice that combines several criteria without a recorded reason', () => {
    const manifest = createManifest({
      verification_matrix: [criterion('AC-1'), criterion('AC-2')],
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          covers: ['FR-1', 'AC-1', 'AC-2'],
        },
      ],
    });

    const report = checkSliceGranularity(manifest);
    expect(report.ok).toBe(false);
    expect(report.findings[0]).toMatchObject({
      slice_id: 'SL-1',
      code: 'combined-without-reason',
      covered_criteria: ['AC-1', 'AC-2'],
    });
  });

  it('allows combining criteria when the slice records why separation would break the work', () => {
    const manifest = createManifest({
      verification_matrix: [criterion('AC-1'), criterion('AC-2')],
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          covers: ['FR-1', 'AC-1', 'AC-2'],
          combine_reason: 'The migration and its read path cannot be proven apart.',
        },
      ],
    });

    expect(checkSliceGranularity(manifest)).toEqual({ ok: true, findings: [] });
  });

  it('treats a blank combine_reason as no reason at all', () => {
    const manifest = createManifest({
      verification_matrix: [criterion('AC-1'), criterion('AC-2')],
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          covers: ['AC-1', 'AC-2'],
          combine_reason: '   ',
        },
      ],
    });

    expect(checkSliceGranularity(manifest).ok).toBe(false);
  });

  it('exempts the fast lane from slicing ceremony entirely', () => {
    const manifest = createManifest({
      classification: { ...createManifest().classification, lane: 'fast' },
      execution_slices: [
        {
          ...createManifest().execution_slices[0],
          slice_id: 'SL-1',
          covers: ['FR-1'],
        },
      ],
    });

    expect(checkSliceGranularity(manifest)).toEqual({ ok: true, findings: [] });
  });
});
