import { describe, expect, it } from 'vitest';

import { BOUNDARY_SCHEMA_VERSION } from '@/compliance/boundary/types.js';
import {
  doctorBoundaryReport,
  doctorObligationIndex,
  doctorSpecReview,
} from '@/compliance/doctor.js';
import type { BoundaryReport } from '@/compliance/boundary/types.js';
import type { ObligationIndex, SpecReviewReport } from '@/compliance/types.js';

describe('doctorObligationIndex', () => {
  it('returns ok with warning when no index is present', () => {
    const result = doctorObligationIndex(null);
    expect(result.ok).toBe(true);
    expect(result.issues[0]!.level).toBe('warning');
  });

  it('fails on schema mismatch and duplicate IDs', () => {
    const index: ObligationIndex = {
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        extracted_at: '2026-04-07T00:00:00.000Z',
        obligation_count: 2,
        schema_version: 999,
        warnings: [],
      },
      obligations: [
        {
          obligation_id: 'FR-1-T1',
          category: 'functional',
          description: 'One',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 1,
          spec_file: 'docs/spec.md',
          affected_by_spec_defects: [],
        },
        {
          obligation_id: 'FR-1-T1',
          category: 'functional',
          description: 'Two',
          pass_criteria: null,
          source_section: 'Spec',
          source_line: 2,
          spec_file: 'docs/spec.md',
          affected_by_spec_defects: [],
        },
      ],
    };

    const result = doctorObligationIndex(index);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes('Unsupported compliance schema_version'),
      ),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Duplicate obligation_id'))).toBe(
      true,
    );
  });

  it('warns on missing spec review and stale reports, and fails on schema mismatch', () => {
    expect(doctorSpecReview(null).ok).toBe(true);

    const review: SpecReviewReport = {
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        reviewed_at: '2026-04-07T00:00:00.000Z',
        defect_count: 1,
        schema_version: 999,
      },
      defects: [],
      pattern_advisories: [],
    };

    const result = doctorSpecReview(review, { spec_is_newer: true });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes('Unsupported spec review schema_version'),
      ),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('stale'))).toBe(true);
  });
});

describe('doctorBoundaryReport', () => {
  it('warns when no boundary report exists', () => {
    const result = doctorBoundaryReport(null);
    expect(result.ok).toBe(true);
    expect(result.issues[0]!.level).toBe('warning');
    expect(result.issues[0]!.message).toContain('compliance boundary');
  });

  it('errors on unsupported schema version', () => {
    const report: BoundaryReport = {
      metadata: { generated_at: new Date().toISOString(), schema_version: 999 },
      total_interfaces: 0,
      total_states: 0,
      handled_count: 0,
      unhandled_count: 0,
      gate_result: 'skip',
      interfaces: [],
    };
    const result = doctorBoundaryReport(report);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('schema_version'))).toBe(true);
  });

  it('warns when unhandled variants are present', () => {
    const report: BoundaryReport = {
      metadata: { generated_at: new Date().toISOString(), schema_version: BOUNDARY_SCHEMA_VERSION },
      total_interfaces: 1,
      total_states: 3,
      handled_count: 2,
      unhandled_count: 1,
      gate_result: 'warn',
      interfaces: [],
    };
    const result = doctorBoundaryReport(report);
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.message.includes('1 unhandled boundary variant'))).toBe(
      true,
    );
  });

  it('uses plural for multiple unhandled variants', () => {
    const report: BoundaryReport = {
      metadata: { generated_at: new Date().toISOString(), schema_version: BOUNDARY_SCHEMA_VERSION },
      total_interfaces: 1,
      total_states: 5,
      handled_count: 3,
      unhandled_count: 2,
      gate_result: 'warn',
      interfaces: [],
    };
    const result = doctorBoundaryReport(report);
    expect(result.issues.some((i) => i.message.includes('2 unhandled boundary variants'))).toBe(
      true,
    );
  });

  it('returns ok with no issues for a clean report', () => {
    const report: BoundaryReport = {
      metadata: { generated_at: new Date().toISOString(), schema_version: BOUNDARY_SCHEMA_VERSION },
      total_interfaces: 1,
      total_states: 3,
      handled_count: 3,
      unhandled_count: 0,
      gate_result: 'pass',
      interfaces: [],
    };
    const result = doctorBoundaryReport(report);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
