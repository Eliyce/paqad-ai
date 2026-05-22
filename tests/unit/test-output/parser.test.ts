import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTestOutput } from '@/test-output/index.js';
import { SchemaValidator } from '@/validators/index.js';

import { TEST_OUTPUT_FIXTURES } from './fixtures.js';

describe('parseTestOutput', () => {
  const validator = new SchemaValidator();

  it.each([
    ['jest-json', 'jest'],
    ['junit-xml', 'phpunit'],
    ['pytest-json', 'pytest'],
    ['go-json', 'go-test'],
    ['rspec-json', 'rspec'],
    ['tap', 'tap-runner'],
  ] as const)('parses %s all-pass fixtures into the canonical schema', async (format, runnerId) => {
    const result = await parseTestOutput({
      runner: { runner_id: runnerId, structured_format: format },
      stdout: TEST_OUTPUT_FIXTURES[format].allPass,
    });

    expect(validator.validate('test-output-result', result).valid).toBe(true);
    expect(result.parse_metadata.parse_strategy).toBe('structured');
    expect(result.parse_metadata.original_size).toBeGreaterThan(0);
    expect(result.parse_metadata.compact_size).toBeGreaterThan(0);
    expect(result.parse_metadata.escalation_reason).toBeNull();
    expect(result.parse_metadata.delta_summary).toBeNull();
    expect(result.summary.failed).toBe(0);
    expect(result.summary.errored).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it.each([
    ['jest-json', 'jest'],
    ['junit-xml', 'phpunit'],
    ['pytest-json', 'pytest'],
    ['go-json', 'go-test'],
    ['rspec-json', 'rspec'],
    ['tap', 'tap-runner'],
  ] as const)(
    'parses %s mixed fixtures and preserves failing diagnostics',
    async (format, runnerId) => {
      const result = await parseTestOutput({
        runner: { runner_id: runnerId, structured_format: format },
        stdout: TEST_OUTPUT_FIXTURES[format].mixed,
      });

      expect(validator.validate('test-output-result', result).valid).toBe(true);
      expect(
        result.summary.failed + result.summary.errored + result.summary.skipped,
      ).toBeGreaterThan(0);
      expect(result.failures.length + result.errors.length).toBeGreaterThan(0);
      expect(result.parse_metadata.compression_ratio).toBeLessThan(1);
      expect(result.parse_metadata.reduction_ratio).toBeGreaterThanOrEqual(0);
      expect(result.parse_metadata.reduction_ratio).toBeLessThanOrEqual(1);
    },
  );

  it('falls back to plain-text parsing when the declared structured parser fails', async () => {
    const result = await parseTestOutput({
      runner: { runner_id: 'jest', structured_format: 'jest-json' },
      stdout: TEST_OUTPUT_FIXTURES['plain-text'].mixed,
    });

    expect(result.parse_metadata.parse_strategy).toBe('plain-text-fallback');
    expect(result.parse_metadata.escalation_occurred).toBe(true);
    expect(result.parse_metadata.escalation_reason).toBe('structured-parse-failed-or-degraded');
    expect(result.parse_metadata.parse_warnings[0]).toContain('Structured parser');
    expect(result.summary.failed).toBe(1);
    expect(result.summary.errored).toBe(1);
  });

  it('merges file-based results across multiple matching outputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-test-output-'));
    mkdirSync(join(root, '.paqad', 'results'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'results', 'a.xml'),
      TEST_OUTPUT_FIXTURES['junit-xml'].allPass,
    );
    writeFileSync(
      join(root, '.paqad', 'results', 'b.xml'),
      TEST_OUTPUT_FIXTURES['junit-xml'].mixed,
    );

    try {
      const result = await parseTestOutput({
        cwd: root,
        runner: {
          runner_id: 'phpunit',
          structured_format: 'junit-xml',
          output_source: 'file',
          output_path_pattern: '.paqad/results/*.xml',
        },
      });

      expect(result.summary.total).toBeGreaterThanOrEqual(6);
      expect(result.summary.failed).toBeGreaterThanOrEqual(1);
      expect(result.summary.errored).toBeGreaterThanOrEqual(1);
      expect(result.parse_metadata.raw_byte_size).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses plain-text runner declarations directly when structured output is disabled', async () => {
    const result = await parseTestOutput({
      runner: { runner_id: 'vitest', structured_format: 'none' },
      stdout: TEST_OUTPUT_FIXTURES['plain-text'].mixed,
    });

    expect(result.parse_metadata.parse_strategy).toBe('plain-text-fallback');
    expect(result.summary.failed).toBe(1);
    expect(result.summary.errored).toBe(1);
  });

  it('is deterministic for repeated parses of the same fixture', async () => {
    const outputs = await Promise.all(
      Array.from({ length: 5 }, () =>
        parseTestOutput({
          runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
          stdout: TEST_OUTPUT_FIXTURES['pytest-json'].mixed,
        }),
      ),
    );

    const serialized = outputs.map((output) => JSON.stringify(output));
    expect(new Set(serialized).size).toBe(1);
  });

  it('emits delta metadata when baseline results are provided', async () => {
    const baseline = await parseTestOutput({
      runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
      stdout: TEST_OUTPUT_FIXTURES['pytest-json'].mixed,
    });
    const current = await parseTestOutput({
      runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
      stdout: TEST_OUTPUT_FIXTURES['pytest-json'].allPass,
      baseline_result: baseline,
    });

    expect(current.parse_metadata.delta_mode_used).toBe(true);
    expect(current.parse_metadata.delta_summary).toEqual(
      expect.objectContaining({
        newly_passing_tests: expect.any(Number),
        newly_failing_tests: expect.any(Number),
        newly_errored_tests: expect.any(Number),
        changed_failure_messages: expect.any(Number),
      }),
    );
    expect(current.failures).toHaveLength(0);
    expect(current.errors).toHaveLength(0);
  });

  it('can opt out of delta-only issue projection when baseline is provided', async () => {
    const baseline = await parseTestOutput({
      runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
      stdout: TEST_OUTPUT_FIXTURES['pytest-json'].allPass,
    });
    const current = await parseTestOutput({
      runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
      stdout: TEST_OUTPUT_FIXTURES['pytest-json'].mixed,
      baseline_result: baseline,
      include_full_issues_with_baseline: true,
    });

    expect(current.parse_metadata.delta_mode_used).toBe(true);
    expect(current.failures.length + current.errors.length).toBeGreaterThan(0);
  });

  it('emits delta metadata for degraded no-output runs when baseline is provided', async () => {
    const baseline = await parseTestOutput({
      runner: { runner_id: 'jest', structured_format: 'jest-json' },
      stdout: TEST_OUTPUT_FIXTURES['jest-json'].mixed,
    });
    const degraded = await parseTestOutput({
      runner: {
        runner_id: 'jest',
        structured_format: 'jest-json',
        output_source: 'file',
      },
      baseline_result: baseline,
    });

    expect(degraded.parse_metadata.parse_strategy).toBe('degraded');
    expect(degraded.parse_metadata.delta_mode_used).toBe(true);
    expect(degraded.parse_metadata.delta_summary).toEqual(
      expect.objectContaining({
        newly_passing_tests: expect.any(Number),
      }),
    );
  });
});
