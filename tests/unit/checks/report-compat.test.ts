import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readChecksReportForFeature } from '@/checks/report-target.js';
import { checksEvidenceGate } from '@/verification/repository/run-repository-verification.js';
import { collectMachineFindings } from '@/review-digest/sources.js';
import { TEST_OUTPUT_SCHEMA_VERSION } from '@/core/types/test-output.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';

function testResult(failed: number): StructuredTestResult {
  return {
    schema_version: TEST_OUTPUT_SCHEMA_VERSION,
    summary: {
      total: 5,
      passed: 5 - failed,
      failed,
      skipped: 0,
      errored: 0,
      duration_ms: 10,
      timestamp: '2026-01-01T00:00:00.000Z',
      runner_id: 'vitest',
    },
    failures:
      failed > 0
        ? [
            {
              test_id: 'boom',
              suite: null,
              message: 'boom',
              stack_trace: null,
              file_path: 'src/x.ts',
              line_number: 3,
              category: 'assertion',
              duration_ms: 1,
            },
          ]
        : [],
    warnings: [],
    parse_metadata: {
      raw_byte_size: 0,
      structured_byte_size: 0,
      compression_ratio: 1,
      original_size: 0,
      compact_size: 0,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: 'structured',
      parse_warnings: [],
    },
    errors: [],
    evidence_scope: {},
  };
}

const V1 = {
  schema_version: 1,
  generated_at: '2026-01-01T00:00:00.000Z',
  passed: true,
  ran: true,
  results: [testResult(0)],
};

const V2_RED = {
  schema_version: 2,
  generated_at: '2026-01-01T00:00:00.000Z',
  passed: false,
  ran: true,
  results: [testResult(1)],
  mode: { parallel_commands: true, test_mode: 'parallel', processes: 11, fallback_reason: null },
  commands: [
    {
      logical_command: 'test',
      command: 'pnpm test',
      exit_code: 1,
      passed: false,
      stage: 3,
      started_at: '',
      ended_at: '',
      duration_ms: 100,
    },
  ],
  isolation_reruns: { performed: true, skipped_reason: null, rerun_count: 3, entries: [] },
  flaky_under_parallel: [],
  meaningful_green: true,
  critical_path: { logical_command: 'test', duration_ms: 100 },
};

// checks.json v2 is additive and read by every v1 reader (issue #554, AC-11 / INV-6).
describe('checks report v1/v2 compatibility', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-compat-'));
    mkdirSync(join(root, '.paqad/checks'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeGlobal(report: unknown): void {
    writeFileSync(join(root, '.paqad/checks/last-run.json'), JSON.stringify(report));
  }

  it('readChecksReportForFeature reads both a v1 and a v2 file', () => {
    writeGlobal(V1);
    expect(readChecksReportForFeature(root, null)?.passed).toBe(true);
    writeGlobal(V2_RED);
    const v2 = readChecksReportForFeature(root, null);
    expect(v2?.passed).toBe(false);
    expect(v2?.results).toHaveLength(1);
  });

  it('checksEvidenceGate reads both, and a v2 red result fails code-tests-lint', () => {
    expect(checksEvidenceGate(V1.results as StructuredTestResult[])?.status).toBe('pass');
    const gate = checksEvidenceGate(V2_RED.results as StructuredTestResult[]);
    expect(gate?.name).toBe('code-tests-lint');
    expect(gate?.status).toBe('fail');
  });

  it('the review digest reads a v2 report from the global path', () => {
    writeGlobal(V2_RED);
    const findings = collectMachineFindings(root);
    expect(findings.some((f) => f.source.startsWith('checks'))).toBe(true);
  });
});
