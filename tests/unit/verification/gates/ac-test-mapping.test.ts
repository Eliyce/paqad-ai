import { describe, expect, it } from 'vitest';

import type { StructuredTestIssue, StructuredTestResult } from '@/core/types/test-output.js';
import {
  AC_ID_PATTERN,
  AcTestMappingGate,
  collectObservedAcIds,
  extractAcIdFromIssue,
} from '@/verification/gates/ac-test-mapping.js';

import { createVerificationContext } from '../shared.fixture.js';

function createIssue(overrides: Partial<StructuredTestIssue> = {}): StructuredTestIssue {
  return {
    test_id: '',
    suite: null,
    message: 'fail',
    stack_trace: null,
    file_path: null,
    line_number: null,
    category: 'assertion',
    duration_ms: null,
    ...overrides,
  };
}

function createResult(overrides: Partial<StructuredTestResult> = {}): StructuredTestResult {
  return {
    schema_version: '1.0.0',
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      errored: 0,
      duration_ms: 1,
      timestamp: '1970-01-01T00:00:00.000Z',
      runner_id: 'vitest',
    },
    failures: [],
    warnings: [],
    parse_metadata: {
      raw_byte_size: 1,
      structured_byte_size: 1,
      compression_ratio: 0,
      original_size: 1,
      compact_size: 1,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: 'structured',
      parse_warnings: [],
    },
    errors: [],
    ...overrides,
  };
}

describe('AcTestMappingGate', () => {
  it('fails when acceptance criteria are not mapped to tests', async () => {
    await expect(
      new AcTestMappingGate().check(createVerificationContext({ ac_test_mapping_passed: false })),
    ).resolves.toMatchObject({ passed: false });
  });

  it('passes with a baseline detail when no structured test results are present', async () => {
    const result = await new AcTestMappingGate().check(
      createVerificationContext({ ac_test_mapping_passed: true }),
    );
    expect(result.passed).toBe(true);
    expect(result.detail).toBe('Acceptance criteria map to tests');
  });

  it('enriches the detail with observed AC ids when failing tests carry them', async () => {
    const result = await new AcTestMappingGate().check(
      createVerificationContext({
        ac_test_mapping_passed: true,
        structured_test_results: [
          createResult({
            failures: [
              createIssue({ test_id: 'auth > AC-1.1 — rejects bad JWT' }),
              createIssue({ test_id: 'auth > AC-1.2 — rejects mismatched alg' }),
            ],
          }),
        ],
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('AC-1.1');
    expect(result.detail).toContain('AC-1.2');
  });
});

describe('extractAcIdFromIssue', () => {
  it('returns the AC id from the test_id when present', () => {
    expect(
      extractAcIdFromIssue(createIssue({ test_id: 'auth > AC-2.3 — rejects expired session' })),
    ).toBe('AC-2.3');
  });

  it('falls back to the suite when the test_id has no AC id', () => {
    expect(
      extractAcIdFromIssue(createIssue({ test_id: 'rejects expired session', suite: 'AC-1' })),
    ).toBe('AC-1');
  });

  it('skips empty candidates before checking the suite', () => {
    expect(extractAcIdFromIssue(createIssue({ test_id: '', suite: 'auth AC-3' }))).toBe('AC-3');
  });

  it('returns null when no AC id is found in either field', () => {
    expect(
      extractAcIdFromIssue(createIssue({ test_id: 'no ac here', suite: 'still none' })),
    ).toBeNull();
  });

  it('uses the AC_ID_PATTERN that matches both single- and two-level ids', () => {
    expect(AC_ID_PATTERN.exec('AC-9')?.[0]).toBe('AC-9');
    expect(AC_ID_PATTERN.exec('AC-9.10')?.[0]).toBe('AC-9.10');
    expect(AC_ID_PATTERN.exec('AC-')).toBeNull();
  });
});

describe('collectObservedAcIds', () => {
  it('returns unique sorted AC ids across failures and errors from multiple results', () => {
    const observed = collectObservedAcIds([
      createResult({
        failures: [
          createIssue({ test_id: 'AC-1.2 — first' }),
          createIssue({ test_id: 'AC-1.1 — second' }),
        ],
      }),
      createResult({
        errors: [
          createIssue({ test_id: 'AC-2.1 — third', category: 'error' }),
          createIssue({ test_id: 'AC-1.2 — duplicate', category: 'error' }),
        ],
      }),
    ]);
    expect(observed).toEqual(['AC-1.1', 'AC-1.2', 'AC-2.1']);
  });

  it('returns an empty array when no AC ids appear in any failure or error', () => {
    expect(
      collectObservedAcIds([
        createResult({
          failures: [createIssue({ test_id: 'no AC here', suite: 'plain suite' })],
        }),
      ]),
    ).toEqual([]);
  });

  it('returns an empty array for an empty input list', () => {
    expect(collectObservedAcIds([])).toEqual([]);
  });
});
