import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checksEvidenceGate,
  runRepositoryVerification,
} from '@/verification/repository/run-repository-verification.js';
import {
  buildRepositoryVerificationContext,
  checksReportStaleness,
} from '@/verification/repository/repository-context.js';
import { computeTreeIdentity } from '@/checks/tree-identity.js';
import { endStage, startStage } from '@/stage-evidence/index.js';
import {
  CHECKS_REPORT_SCHEMA_VERSION,
  writeChecksReport,
  writeFeatureChecks,
} from '@/checks/report-store.js';
import { resolveActiveFeature } from '@/feature-evidence/stage-ledger.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';
import { commitAll, initGitRepo, writeRepoFile } from '../../_helpers/git-repo.js';
import { writeManagedGitignoreBlock } from '@/onboarding/gitignore-writer.js';
import { useTempRoots } from '../../_helpers/temp-roots.js';
import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';

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

describe('checksEvidenceGate', () => {
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

  it('reads Inconclusive for a green or red report that ran on different files', () => {
    for (const failed of [0, 1]) {
      expect(
        checksEvidenceGate([structuredResult('test', failed)], { stale: 'different-files' }),
      ).toEqual({
        name: 'code-tests-lint',
        status: 'inconclusive',
        detail:
          'Checks ran on different files than the ones in this change now. Run paqad-ai checks run again.',
        remediation: 'Run `paqad-ai checks run` on the current files.',
        failures: [],
      });
    }
  });

  it('reads Inconclusive when the files a report ran on cannot be confirmed', () => {
    const gate = checksEvidenceGate([structuredResult('test', 0)], { stale: 'unconfirmed' });
    expect(gate?.status).toBe('inconclusive');
    expect(gate?.detail).toBe(
      'Checks could not confirm which files they ran on. Run paqad-ai checks run again.',
    );
  });

  it("keeps today's verdict without a stale flag and stays null without results", () => {
    expect(checksEvidenceGate([structuredResult('test', 0)], {})?.status).toBe('pass');
    expect(checksEvidenceGate([], { stale: 'different-files' })).toBeNull();
  });
});

describe('runRepositoryVerification consumes the check report', () => {
  it('blocks the verdict when the check report is red', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      structured_test_results: [structuredResult('test', 1)],
    });
    ownInFlightChange(context.project_root);
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
    ownInFlightChange(context.project_root);
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

describe('runRepositoryVerification does not count stale checks as verified', () => {
  async function receiptFor(stale: 'different-files' | undefined): Promise<string> {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      code_changed: true,
      changed_files: ['src/app.ts'],
      code_tests_lint_passed: true,
      structured_test_results: [structuredResult('test', 0)],
      ...(stale ? { checks_report_stale: stale } : {}),
    });
    const owner = { sessionId: 'ses-stale', adapter: 'claude-code' };
    ownInFlightChange(context.project_root, 'ses-stale');
    startStage(context.project_root, 'checks', owner);
    const rel = '.paqad/artifacts/checks.md';
    mkdirSync(join(context.project_root, '.paqad/artifacts'), { recursive: true });
    writeFileSync(join(context.project_root, rel), '# checks\n');
    endStage(context.project_root, 'checks', { artifactPaths: [rel] }, owner);
    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      hostSessionId: 'ses-stale',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const gate = verdict.gates.find((g) => g.gate === 'code-tests-lint');
    expect(gate?.status).toBe(stale ? 'inconclusive' : 'pass');
    return verdict.receipt ?? '';
  }

  it('marks the checks stage as not verified when the report is stale', async () => {
    expect(await receiptFor('different-files')).toContain('tests not verified');
    expect(await receiptFor(undefined)).not.toContain('tests not verified');
  });
});

describe('checks report freshness against the current tree', () => {
  const makeRoot = useTempRoots('paqad-freshness-');

  function repo(): string {
    const root = makeRoot();
    initGitRepo(root, { 'src/app.ts': 'export const a = 1;\n', '.paqad/scripts/x.sh': 'x\n' });
    writeManagedGitignoreBlock(root);
    commitAll(root);
    return root;
  }

  function writeReport(root: string, tree: ReturnType<typeof computeTreeIdentity> | undefined) {
    writeChecksReport(root, {
      schema_version: CHECKS_REPORT_SCHEMA_VERSION,
      generated_at: '2026-01-01T00:00:00.000Z',
      passed: true,
      ran: true,
      results: [structuredResult('test', 0)],
      ...(tree ? { tree } : {}),
    });
  }

  async function contextOf(root: string) {
    return (
      await buildRepositoryVerificationContext({ projectRoot: root, origin: 'hook-completion' })
    ).context;
  }

  it('is fresh on the same tree, stale after an edit, and fresh again after a decision packet is written', async () => {
    const root = repo();
    writeReport(root, computeTreeIdentity(root)!);
    expect((await contextOf(root)).checks_report_stale).toBeUndefined();

    writeRepoFile(root, '.paqad/decisions/pending/D-1.json', '{"id":"D-1"}\n');
    expect((await contextOf(root)).checks_report_stale).toBeUndefined();

    writeRepoFile(root, 'src/app.ts', 'export const a = 2;\n');
    ownInFlightChange(root);
    const context = await contextOf(root);
    expect(context.checks_report_stale).toBe('different-files');
    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const gate = verdict.gates.find((g) => g.gate === 'code-tests-lint');
    expect(gate?.status).toBe('inconclusive');
  });

  it("keeps today's verdict for a report without a tree or a schema 2 report", async () => {
    const root = repo();
    writeReport(root, undefined);
    expect((await contextOf(root)).checks_report_stale).toBeUndefined();
    writeChecksReport(root, {
      schema_version: 2,
      passed: true,
      ran: true,
      results: [structuredResult('test', 0)],
    });
    writeRepoFile(root, 'src/app.ts', 'export const a = 3;\n');
    expect((await contextOf(root)).checks_report_stale).toBeUndefined();
  });

  it('is unconfirmed when the current tree cannot be computed or runs past the limit', () => {
    const root = repo();
    const report = {
      schema_version: CHECKS_REPORT_SCHEMA_VERSION,
      passed: true,
      ran: true,
      results: [],
      tree: computeTreeIdentity(root)!,
    };
    expect(checksReportStaleness(root, report)).toBeUndefined();
    expect(checksReportStaleness(root, report, 0)).toBe('unconfirmed');
    expect(checksReportStaleness(root, { ...report, tree_after_run: 'moved' })).toBe(
      'different-files',
    );
    expect(checksReportStaleness(root, { ...report, tree_after_run: 'unconfirmed' })).toBe(
      'unconfirmed',
    );
    rmSync(join(root, '.git'), { recursive: true, force: true });
    expect(checksReportStaleness(root, report)).toBe('unconfirmed');
    expect(checksReportStaleness(root, null)).toBeUndefined();
  });
});

describe('buildRepositoryVerificationContext reads the persisted report', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ctx-checks-'));
    seedGitChangedFiles(root, ['src/app.ts']);
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the report from the active feature bundle when one is open', async () => {
    process.env.CLAUDE_SESSION_ID = 'ses-ctx';
    const dir = resolveActiveFeature(root, 'ses-ctx', { title: 'thing', issue: '528' });
    writeFeatureChecks(root, dir, {
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
