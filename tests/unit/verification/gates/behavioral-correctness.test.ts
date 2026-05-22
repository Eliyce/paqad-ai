import { describe, expect, it } from 'vitest';

import { BehavioralCorrectnessGate } from '@/verification/gates/behavioral-correctness.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('BehavioralCorrectnessGate', () => {
  it('fails when behavioral correctness fails', async () => {
    await expect(
      new BehavioralCorrectnessGate().check(
        createVerificationContext({ behavioral_correctness_passed: false }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });

  it('passes from structured test results when no failures remain', async () => {
    await expect(
      new BehavioralCorrectnessGate().check(
        createVerificationContext({
          code_changed: true,
          changed_files: ['src/service.ts'],
          behavioral_correctness_passed: false,
          structured_test_results: [
            {
              schema_version: '1.0.0',
              summary: {
                total: 2,
                passed: 2,
                failed: 0,
                skipped: 0,
                errored: 0,
                duration_ms: 10,
                timestamp: '1970-01-01T00:00:00.000Z',
                runner_id: 'pytest',
              },
              failures: [],
              warnings: [],
              parse_metadata: {
                raw_byte_size: 100,
                structured_byte_size: 70,
                compression_ratio: 0.3,
                original_size: 100,
                compact_size: 70,
                reduction_ratio: 0.3,
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

  it('returns inconclusive when structured test results have a degraded parse strategy', async () => {
    const result = await new BehavioralCorrectnessGate().check(
      createVerificationContext({
        code_changed: true,
        changed_files: ['src/service.ts'],
        behavioral_correctness_passed: true,
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
              runner_id: 'pytest',
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
              related_paths: ['src/service.ts'],
            },
          },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.inconclusive).toBe(true);
  });

  it('fails from structured test results when behavioral failures are present', async () => {
    await expect(
      new BehavioralCorrectnessGate().check(
        createVerificationContext({
          code_changed: true,
          changed_files: ['src/service.ts'],
          behavioral_correctness_passed: true,
          structured_test_results: [
            {
              schema_version: '1.0.0',
              summary: {
                total: 2,
                passed: 1,
                failed: 0,
                skipped: 0,
                errored: 1,
                duration_ms: 10,
                timestamp: '1970-01-01T00:00:00.000Z',
                runner_id: 'pytest',
              },
              failures: [],
              warnings: [],
              parse_metadata: {
                raw_byte_size: 100,
                structured_byte_size: 70,
                compression_ratio: 0.3,
                original_size: 100,
                compact_size: 70,
                reduction_ratio: 0.3,
                delta_mode_used: false,
                escalation_occurred: false,
                escalation_reason: null,
                delta_summary: null,
                parse_strategy: 'structured',
                parse_warnings: [],
              },
              errors: [
                {
                  test_id: 'behavior fails',
                  suite: null,
                  message: 'RuntimeError',
                  stack_trace: null,
                  file_path: null,
                  line_number: null,
                  category: 'error',
                  duration_ms: null,
                },
              ],
              evidence_scope: {
                related_paths: ['src/service.ts'],
              },
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ passed: false });
  });

  it('returns inconclusive when changed code has only weak test evidence', async () => {
    const result = await new BehavioralCorrectnessGate().check(
      createVerificationContext({
        code_changed: true,
        test_files_changed: true,
        changed_files: ['src/service.ts', 'tests/unit/service.test.ts'],
        behavioral_correctness_passed: true,
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.detail).toContain('Only weak test evidence recorded for changed code');
  });
});
