import { describe, expect, it } from 'vitest';

import { CodeTestsLintGate } from '@/verification/gates/code-tests-lint.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('CodeTestsLintGate', () => {
  it('fails when code changed without any verification evidence', async () => {
    const result = await new CodeTestsLintGate().check(
      createVerificationContext({
        changed_files: ['src/billing/service.ts'],
        changed_files_source: 'git-status',
        code_changed: true,
        test_files_changed: false,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('No test evidence recorded for changed code');
    expect(result.remediation).toContain('Add verification evidence');
  });

  it('falls back to "unknown files" when changed_files is empty but code_changed is true', async () => {
    const result = await new CodeTestsLintGate().check(
      createVerificationContext({
        changed_files: [],
        changed_files_source: 'none',
        code_changed: true,
        test_files_changed: false,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('unknown files');
  });

  it('fails when code, tests, or lint fail', async () => {
    await expect(
      new CodeTestsLintGate().check(createVerificationContext({ code_tests_lint_passed: false })),
    ).resolves.toMatchObject({ passed: false });
  });

  it('fails when structured test results contain failures', async () => {
    await expect(
      new CodeTestsLintGate().check(
        createVerificationContext({
          code_changed: true,
          changed_files: ['src/math.ts'],
          code_tests_lint_passed: true,
          structured_test_results: [
            {
              schema_version: '1.0.0',
              summary: {
                total: 2,
                passed: 1,
                failed: 1,
                skipped: 0,
                errored: 0,
                duration_ms: 10,
                timestamp: '1970-01-01T00:00:00.000Z',
                runner_id: 'jest',
              },
              failures: [
                {
                  test_id: 'math divides',
                  suite: 'math',
                  message: 'Expected 4 to equal 5',
                  stack_trace: null,
                  file_path: 'src/math.test.ts',
                  line_number: 14,
                  category: 'assertion',
                  duration_ms: 5,
                },
              ],
              warnings: [],
              parse_metadata: {
                raw_byte_size: 100,
                structured_byte_size: 80,
                compression_ratio: 0.2,
                original_size: 100,
                compact_size: 80,
                reduction_ratio: 0.2,
                delta_mode_used: false,
                escalation_occurred: false,
                escalation_reason: null,
                delta_summary: null,
                parse_strategy: 'structured',
                parse_warnings: [],
              },
              errors: [],
              evidence_scope: {
                related_paths: ['src/math.ts'],
              },
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });

  it('returns inconclusive when structured test results have a degraded parse strategy', async () => {
    const result = await new CodeTestsLintGate().check(
      createVerificationContext({
        code_changed: true,
        changed_files: ['src/math.ts'],
        code_tests_lint_passed: true,
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 0,
              passed: 0,
              failed: 0,
              skipped: 0,
              errored: 0,
              duration_ms: 0,
              timestamp: '1970-01-01T00:00:00.000Z',
              runner_id: 'jest',
            },
            failures: [],
            warnings: [],
            parse_metadata: {
              raw_byte_size: 100,
              structured_byte_size: 0,
              compression_ratio: 0,
              original_size: 100,
              compact_size: 0,
              reduction_ratio: 1,
              delta_mode_used: false,
              escalation_occurred: false,
              escalation_reason: null,
              delta_summary: null,
              parse_strategy: 'degraded',
              parse_warnings: ['Runner produced empty output'],
            },
            errors: [],
            evidence_scope: {
              related_paths: ['src/math.ts'],
            },
          },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.inconclusive).toBe(true);
  });

  it('fails when code changed and only weak file-touch evidence exists', async () => {
    await expect(
      new CodeTestsLintGate().check(
        createVerificationContext({
          code_changed: true,
          test_files_changed: true,
          changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });

  it('passes when structured test results are fully green and scope-mapped', async () => {
    await expect(
      new CodeTestsLintGate().check(
        createVerificationContext({
          code_changed: true,
          changed_files: ['src/service.ts'],
          code_tests_lint_passed: false,
          structured_test_results: [
            {
              schema_version: '1.0.0',
              summary: {
                total: 3,
                passed: 3,
                failed: 0,
                skipped: 0,
                errored: 0,
                duration_ms: 10,
                timestamp: '1970-01-01T00:00:00.000Z',
                runner_id: 'jest',
              },
              failures: [],
              warnings: [],
              parse_metadata: {
                raw_byte_size: 100,
                structured_byte_size: 80,
                compression_ratio: 0.2,
                original_size: 100,
                compact_size: 80,
                reduction_ratio: 0.2,
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
      ),
    ).resolves.toMatchObject({ passed: true });
  });

  it('fails when structured test results are green but not mapped to the changed scope', async () => {
    const result = await new CodeTestsLintGate().check(
      createVerificationContext({
        code_changed: true,
        changed_files: ['src/service.ts'],
        structured_test_results: [
          {
            schema_version: '1.0.0',
            summary: {
              total: 3,
              passed: 3,
              failed: 0,
              skipped: 0,
              errored: 0,
              duration_ms: 10,
              timestamp: '1970-01-01T00:00:00.000Z',
              runner_id: 'jest',
            },
            failures: [],
            warnings: [],
            parse_metadata: {
              raw_byte_size: 100,
              structured_byte_size: 80,
              compression_ratio: 0.2,
              original_size: 100,
              compact_size: 80,
              reduction_ratio: 0.2,
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
    );

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Only weak test evidence recorded for changed code');
  });
});
