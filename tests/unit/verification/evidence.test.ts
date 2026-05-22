import { mkdtempSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GateResult, VerificationGate } from '@/core/types/verification.js';
import { VERIFICATION_GATES } from '@/core/types/verification.js';
import { VERIFICATION_EVIDENCE_SCHEMA_VERSION } from '@/core/types/verification-evidence.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import {
  VERIFICATION_EVIDENCE_RELATIVE_PATH,
  buildVerificationEvidence,
  writeVerificationEvidence,
} from '@/verification/evidence.js';

function pass(gate: VerificationGate, detail = `${gate} passed`): GateResult {
  return { gate, passed: true, detail };
}

function fail(gate: VerificationGate, detail: string, remediation: string): GateResult {
  return { gate, passed: false, detail, remediation };
}

function inconclusive(gate: VerificationGate, detail: string, remediation: string): GateResult {
  return { gate, passed: false, inconclusive: true, detail, remediation };
}

function allPassingResults(): GateResult[] {
  return VERIFICATION_GATES.map((gate) => pass(gate));
}

const baseStructuredFixture: StructuredTestResult = {
  schema_version: '1.0.0',
  summary: {
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    errored: 0,
    duration_ms: 5,
    timestamp: '1970-01-01T00:00:00.000Z',
    runner_id: 'vitest',
  },
  failures: [
    {
      test_id: 'tests/unit/auth.test.ts > AC-1.1 — rejects bad JWT',
      suite: 'auth',
      message: 'expected 200 to be 401',
      stack_trace: 'AssertionError\n  at tests/unit/auth.test.ts:47:24',
      file_path: 'tests/unit/auth.test.ts',
      line_number: 47,
      category: 'assertion',
      duration_ms: 3,
    },
  ],
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
  evidence_scope: { related_paths: ['src/auth.ts'] },
};

describe('buildVerificationEvidence', () => {
  it('produces a fully-populated evidence object when every gate passes', () => {
    const evidence = buildVerificationEvidence({
      results: allPassingResults(),
      context: { structured_test_results: [] },
      run_id: 'r-1',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    expect(evidence.schema_version).toBe(VERIFICATION_EVIDENCE_SCHEMA_VERSION);
    expect(evidence.overall_status).toBe('pass');
    expect(evidence.first_failure_gate).toBeNull();
    expect(evidence.gates).toHaveLength(VERIFICATION_GATES.length);
    expect(evidence.gates.every((gate) => gate.status === 'pass')).toBe(true);
    expect(evidence.gates.every((gate) => gate.failures.length === 0)).toBe(true);
    expect(evidence.gates.map((gate) => gate.name)).toEqual([...VERIFICATION_GATES]);
  });

  it('marks gates that did not run as skipped without a remediation', () => {
    const partialResults = [pass('change-completeness'), pass('requirement-completeness')];

    const evidence = buildVerificationEvidence({
      results: partialResults,
      context: { structured_test_results: [] },
      run_id: 'r-2',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:00.500Z',
    });

    const skipped = evidence.gates.filter((gate) => gate.status === 'skipped');
    expect(skipped.length).toBe(VERIFICATION_GATES.length - 2);
    for (const gate of skipped) {
      expect(gate.remediation).toBeNull();
      expect(gate.detail).toMatch(/did not run/i);
    }
    expect(evidence.overall_status).toBe('pass');
    expect(evidence.first_failure_gate).toBeNull();
  });

  it('records the first non-passing gate and folds structured test failures into code-tests-lint', () => {
    const results = VERIFICATION_GATES.map((gate) =>
      gate === 'code-tests-lint'
        ? fail(gate, 'Structured test results report failures for vitest', 'Fix the failing test.')
        : pass(gate),
    );

    const evidence = buildVerificationEvidence({
      results,
      context: { structured_test_results: [baseStructuredFixture] },
      run_id: 'r-3',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:42.000Z',
    });

    expect(evidence.overall_status).toBe('fail');
    expect(evidence.first_failure_gate).toBe('code-tests-lint');

    const ctlGate = evidence.gates.find((gate) => gate.name === 'code-tests-lint');
    expect(ctlGate).toBeDefined();
    expect(ctlGate?.status).toBe('fail');
    expect(ctlGate?.remediation).toBe('Fix the failing test.');
    expect(ctlGate?.failures).toHaveLength(1);

    const failure = ctlGate?.failures[0];
    expect(failure?.category).toBe('test-failure');
    expect(failure?.file).toBe('tests/unit/auth.test.ts');
    expect(failure?.line).toBe(47);
    expect(failure?.ac_id).toBe('AC-1.1');
    expect(failure?.message).toBe('expected 200 to be 401');
    expect(failure?.stderr_excerpt).toContain('AssertionError');
  });

  it('treats inconclusive gates as failures in overall status but preserves the inconclusive label', () => {
    const results = VERIFICATION_GATES.map((gate) =>
      gate === 'code-tests-lint'
        ? inconclusive(gate, 'parse degraded', 'Re-run the test runner.')
        : pass(gate),
    );

    const evidence = buildVerificationEvidence({
      results,
      context: { structured_test_results: [] },
      run_id: 'r-4',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    expect(evidence.overall_status).toBe('fail');
    expect(evidence.first_failure_gate).toBe('code-tests-lint');
    const ctlGate = evidence.gates.find((gate) => gate.name === 'code-tests-lint');
    expect(ctlGate?.status).toBe('inconclusive');
  });

  it('returns null ac_id when no AC identifier is present in the test name or suite', () => {
    const fixtureWithoutAcId: StructuredTestResult = {
      ...baseStructuredFixture,
      failures: [
        {
          ...baseStructuredFixture.failures[0],
          test_id: 'tests/unit/auth.test.ts > rejects bad JWT',
          suite: 'auth',
        },
      ],
    };

    const results = VERIFICATION_GATES.map((gate) =>
      gate === 'code-tests-lint' ? fail(gate, 'failed', 'fix it') : pass(gate),
    );

    const evidence = buildVerificationEvidence({
      results,
      context: { structured_test_results: [fixtureWithoutAcId] },
      run_id: 'r-5',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    const ctlGate = evidence.gates.find((gate) => gate.name === 'code-tests-lint');
    expect(ctlGate?.failures[0]?.ac_id).toBeNull();
  });

  it('truncates stderr_excerpt to the configured byte budget', () => {
    const huge = 'x'.repeat(5000);
    const fixtureWithHugeStack: StructuredTestResult = {
      ...baseStructuredFixture,
      failures: [
        {
          ...baseStructuredFixture.failures[0],
          stack_trace: huge,
        },
      ],
    };
    const results = VERIFICATION_GATES.map((gate) =>
      gate === 'code-tests-lint' ? fail(gate, 'failed', 'fix it') : pass(gate),
    );

    const evidence = buildVerificationEvidence({
      results,
      context: { structured_test_results: [fixtureWithHugeStack] },
      run_id: 'r-6',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    const ctlGate = evidence.gates.find((gate) => gate.name === 'code-tests-lint');
    const excerpt = ctlGate?.failures[0]?.stderr_excerpt ?? '';
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('folds structured runner errors into code-tests-lint evidence failures', () => {
    const fixtureWithErrors: StructuredTestResult = {
      ...baseStructuredFixture,
      failures: [],
      errors: [
        {
          ...baseStructuredFixture.failures[0],
          test_id: 'tests/unit/auth.test.ts > AC-2.1 — bootstraps auth suite',
          category: 'error',
          stack_trace: null,
          message: 'beforeEach failed',
        },
        {
          ...baseStructuredFixture.failures[0],
          test_id: 'tests/unit/auth.test.ts > AC-2.2 — finishes promptly',
          category: 'timeout',
          stack_trace: 'Timed out after 5000ms',
        },
        {
          ...baseStructuredFixture.failures[0],
          test_id: 'tests/unit/auth.test.ts > AC-2.3 — reports parser fallback',
          category: 'unknown',
          message: '',
          stack_trace: null,
        },
        {
          ...baseStructuredFixture.failures[0],
          test_id: 'tests/unit/auth.test.ts > AC-2.4 — keeps defensive fallback',
          category: 'unexpected' as 'assertion',
        },
        {
          ...baseStructuredFixture.failures[0],
          test_id: '',
          suite: null,
        },
      ],
    };
    const results = VERIFICATION_GATES.map((gate) =>
      gate === 'code-tests-lint' ? fail(gate, 'failed', 'fix it') : pass(gate),
    );

    const evidence = buildVerificationEvidence({
      results,
      context: { structured_test_results: [fixtureWithErrors] },
      run_id: 'r-7',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    const ctlGate = evidence.gates.find((gate) => gate.name === 'code-tests-lint');
    expect(ctlGate?.failures.map((failure) => failure.category)).toEqual([
      'test-error',
      'test-timeout',
      'test-failure',
      'test-failure',
      'test-failure',
    ]);
    expect(ctlGate?.failures[0]?.stderr_excerpt).toBe('beforeEach failed');
    expect(ctlGate?.failures[2]?.stderr_excerpt).toBeNull();
    expect(ctlGate?.failures[4]?.test_id).toBeNull();
  });
});

describe('writeVerificationEvidence', () => {
  it('writes the evidence file at the canonical path and the content round-trips through JSON', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-evidence-'));

    const evidence = buildVerificationEvidence({
      results: allPassingResults(),
      context: { structured_test_results: [] },
      run_id: 'r-write-1',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    const targetPath = await writeVerificationEvidence(evidence, { project_root: projectRoot });

    expect(targetPath).toBe(join(projectRoot, VERIFICATION_EVIDENCE_RELATIVE_PATH));

    const contents = readFileSync(targetPath, 'utf8');
    expect(contents.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(contents);
    expect(parsed.schema_version).toBe(VERIFICATION_EVIDENCE_SCHEMA_VERSION);
    expect(parsed.run_id).toBe('r-write-1');
    expect(parsed.gates).toHaveLength(VERIFICATION_GATES.length);
  });

  it('does not leave a temp file behind after a successful write', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-evidence-'));

    const evidence = buildVerificationEvidence({
      results: allPassingResults(),
      context: { structured_test_results: [] },
      run_id: 'r-write-2',
      started_at: '2026-05-09T10:00:00.000Z',
      completed_at: '2026-05-09T10:00:01.000Z',
    });

    await writeVerificationEvidence(evidence, { project_root: projectRoot });

    const sessionDir = join(projectRoot, '.paqad/session');
    const entries = await readdir(sessionDir);
    expect(entries).toContain('verification-evidence.json');
    expect(entries.some((name) => name.includes('.tmp-'))).toBe(false);
  });
});
