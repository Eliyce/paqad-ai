import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checksEvidenceGate,
  runRepositoryVerification,
} from '@/verification/repository/run-repository-verification.js';
import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { CHECKS_REPORT_SCHEMA_VERSION, writeChecksReport } from '@/checks/report-store.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';

import { createVerificationContext } from '../shared.fixture.js';

function structuredResult(runnerId: string, failed: number): StructuredTestResult {
  return {
    schema_version: '1.0.0',
    summary: {
      total: 1,
      passed: failed > 0 ? 0 : 1,
      failed,
      skipped: 0,
      errored: 0,
      duration_ms: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      runner_id: runnerId,
    },
    failures: [],
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
    evidence_scope: { related_paths: ['src/app.ts'] },
  };
}

describe('checksEvidenceGate (#318)', () => {
  it('returns null when there are no structured results (Inconclusive, not a pass)', () => {
    expect(checksEvidenceGate(undefined)).toBeNull();
    expect(checksEvidenceGate([])).toBeNull();
  });

  it('passes when every result is green', () => {
    const gate = checksEvidenceGate([structuredResult('test', 0)]);
    expect(gate?.status).toBe('pass');
    expect(gate?.name).toBe('code-tests-lint');
  });

  it('fails when any result reports a failure', () => {
    const gate = checksEvidenceGate([structuredResult('test', 1)]);
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('test');
  });
});

describe('runRepositoryVerification consumes the check report (#318)', () => {
  it('blocks the verdict when the check report is red', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      structured_test_results: [structuredResult('test', 1)],
    });
    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });

    expect(verdict.ok).toBe(false);
    const gate = verdict.gates.find((g) => g.gate === 'code-tests-lint');
    expect(gate?.status).toBe('fail');
  });

  it('keeps a green report from blocking (the gate passes)', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      structured_test_results: [structuredResult('test', 0)],
    });
    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const gate = verdict.gates.find((g) => g.gate === 'code-tests-lint');
    expect(gate?.status).toBe('pass');
  });
});

describe('buildRepositoryVerificationContext reads the persisted report (#318)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ctx-checks-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['src/app.ts']));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('populates structured_test_results and derives code_tests_lint_passed from the report', async () => {
    writeChecksReport(root, {
      schema_version: CHECKS_REPORT_SCHEMA_VERSION,
      generated_at: '2026-01-01T00:00:00.000Z',
      passed: false,
      ran: true,
      results: [structuredResult('test', 1)],
    });

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.structured_test_results).toHaveLength(1);
    expect(context.code_tests_lint_passed).toBe(false);
  });

  it('leaves results undefined and escalates when no report is on record', async () => {
    const { context, escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.structured_test_results).toBeUndefined();
    expect(escalations.some((e) => e.includes('test-evidence'))).toBe(true);
  });
});
