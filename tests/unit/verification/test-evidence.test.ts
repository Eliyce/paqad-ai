import { describe, expect, it } from 'vitest';

import { assessTestEvidence } from '@/verification/test-evidence.js';

describe('assessTestEvidence', () => {
  it('returns none when no test evidence exists', () => {
    expect(
      assessTestEvidence({
        changed_files: ['src/service.ts'],
        modules: ['billing'],
        test_files_changed: false,
      }),
    ).toEqual({
      strength: 'none',
      detail: 'No test evidence recorded for changed code (src/service.ts)',
      matched_runner_ids: [],
    });
  });

  it('returns weak evidence when only test files changed', () => {
    expect(
      assessTestEvidence({
        changed_files: ['src/service.ts'],
        modules: ['billing'],
        test_files_changed: true,
      }),
    ).toEqual({
      strength: 'weak',
      detail:
        'Only weak test evidence recorded for changed code (src/service.ts). Test files changed, but no structured verification evidence was recorded for the affected scope.',
      matched_runner_ids: [],
    });
  });

  it('returns weak evidence when structured results are not scope-mapped', () => {
    expect(
      assessTestEvidence({
        changed_files: ['src/service.ts'],
        modules: ['billing'],
        test_files_changed: false,
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              skipped: 0,
              errored: 0,
              duration_ms: 5,
              timestamp: '1970-01-01T00:00:00.000Z',
              runner_id: 'vitest',
            },
            failures: [],
            warnings: [],
            parse_metadata: {
              raw_byte_size: 10,
              structured_byte_size: 10,
              compression_ratio: 0,
              original_size: 10,
              compact_size: 10,
              reduction_ratio: 0,
              delta_mode_used: false,
              escalation_occurred: false,
              escalation_reason: null,
              delta_summary: null,
              parse_strategy: 'structured',
              parse_warnings: [],
            },
            errors: [],
          },
        ],
      }),
    ).toEqual({
      strength: 'weak',
      detail:
        'Only weak test evidence recorded for changed code (src/service.ts). Structured test results exist, but they are not mapped to the affected files or modules.',
      matched_runner_ids: [],
    });
  });

  it('returns strong evidence when a structured result maps to a changed file', () => {
    expect(
      assessTestEvidence({
        changed_files: ['src/service.ts'],
        modules: ['billing'],
        test_files_changed: false,
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              skipped: 0,
              errored: 0,
              duration_ms: 5,
              timestamp: '1970-01-01T00:00:00.000Z',
              runner_id: 'vitest',
            },
            failures: [],
            warnings: [],
            parse_metadata: {
              raw_byte_size: 10,
              structured_byte_size: 10,
              compression_ratio: 0,
              original_size: 10,
              compact_size: 10,
              reduction_ratio: 0,
              delta_mode_used: false,
              escalation_occurred: false,
              escalation_reason: null,
              delta_summary: null,
              parse_strategy: 'structured',
              parse_warnings: [],
            },
            errors: [],
            evidence_scope: {
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    ).toEqual({
      strength: 'strong',
      detail: 'Strong test evidence recorded for changed code (src/service.ts) via vitest.',
      matched_runner_ids: ['vitest'],
    });
  });

  it('matches modules case-insensitively and normalizes path separators', () => {
    expect(
      assessTestEvidence({
        changed_files: ['src/service.ts'],
        modules: ['Billing'],
        test_files_changed: false,
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 2,
              passed: 2,
              failed: 0,
              skipped: 0,
              errored: 0,
              duration_ms: 8,
              timestamp: '1970-01-01T00:00:00.000Z',
              runner_id: 'jest',
            },
            failures: [],
            warnings: [],
            parse_metadata: {
              raw_byte_size: 20,
              structured_byte_size: 18,
              compression_ratio: 0.1,
              original_size: 20,
              compact_size: 18,
              reduction_ratio: 0.1,
              delta_mode_used: false,
              escalation_occurred: false,
              escalation_reason: null,
              delta_summary: null,
              parse_strategy: 'structured',
              parse_warnings: [],
            },
            errors: [],
            evidence_scope: {
              related_paths: ['SRC\\UNRELATED.TS'],
              related_modules: ['billing'],
            },
          },
        ],
      }),
    ).toEqual({
      strength: 'strong',
      detail: 'Strong test evidence recorded for changed code (src/service.ts) via jest.',
      matched_runner_ids: ['jest'],
    });
  });
});
