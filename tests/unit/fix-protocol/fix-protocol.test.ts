import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProofCheck, RunFixProtocolInput } from '@/fix-protocol/index.js';
import { runFixProtocol, readRegressionGuard } from '@/fix-protocol/index.js';
import type { TestIssueSnapshot } from '@/core/types/token-efficiency.js';
import type { VerificationEvidenceFailure } from '@/core/types/verification-evidence.js';

const PROOF: ProofCheck = {
  test_file: 'tests/unit/x.test.ts',
  test_id: 'x > reproduces the bug',
  command: 'pnpm vitest run tests/unit/x.test.ts',
};

const FAILING_EVIDENCE: VerificationEvidenceFailure = {
  category: 'test-failure',
  file: 'src/x.ts',
  line: 12,
  test_id: 'x > reproduces the bug',
  suite: 'x',
  ac_id: 'AC-1',
  message: 'expected fixed behaviour',
  stderr_excerpt: null,
};

const failing = (id: string): TestIssueSnapshot => ({
  test_id: id,
  message: 'f',
  status: 'failed',
});

describe('runFixProtocol', () => {
  let projectRoot: string;

  function baseInput(overrides: Partial<RunFixProtocolInput> = {}): RunFixProtocolInput {
    return {
      project_root: projectRoot,
      defect_id: 'DEF-1',
      change: { files: [{ path: 'src/x.ts', added_lines: ['return fixed;'], removed_lines: [] }] },
      proof: PROOF,
      baseline: { captured_at: '2026-06-07T00:00:00Z', source: 'rerun', issues: [] },
      failing_evidence: FAILING_EVIDENCE,
      linked_ac_id: 'AC-1',
      now: '2026-06-07T02:00:00.000Z',
      runProofOnUnfixedTree: vi.fn(async () => ({ passed: false, output: 'fails as expected' })),
      applyFix: vi.fn(async () => {}),
      runProofOnFixedTree: vi.fn(async () => ({ passed: true, output: 'now passes' })),
      runFullSuiteAfterFix: vi.fn(async () => []),
      ...overrides,
    };
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-fixproto-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('completes the four steps and persists a regression guard on the happy path', async () => {
    const input = baseInput();
    const result = await runFixProtocol(input);

    expect(result.status).toBe('fixed');
    expect(result.guard_path).toBeDefined();
    const guard = await readRegressionGuard(projectRoot, 'DEF-1');
    expect(guard?.proof.test_id).toBe(PROOF.test_id);
    expect(guard?.linked_ac_id).toBe('AC-1');
    expect(guard?.failing_evidence).toEqual(FAILING_EVIDENCE);

    // Ordering: the proof ran on the unfixed tree before the fix was applied.
    const unfixedOrder = (input.runProofOnUnfixedTree as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const applyOrder = (input.applyFix as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(unfixedOrder).toBeLessThan(applyOrder);
  });

  it('persists a guard with a null linked_ac_id when none is supplied', async () => {
    const input = baseInput({ linked_ac_id: undefined });
    const result = await runFixProtocol(input);

    expect(result.status).toBe('fixed');
    const guard = await readRegressionGuard(projectRoot, 'DEF-1');
    expect(guard?.linked_ac_id).toBeNull();
  });

  it('skips proof-first for a cosmetic change but still applies it (stays light)', async () => {
    const input = baseInput({
      change: { files: [{ path: 'src/x.ts', added_lines: ['// note'], removed_lines: [] }] },
    });
    const result = await runFixProtocol(input);

    expect(result.status).toBe('skipped-no-behaviour-change');
    expect(input.applyFix).toHaveBeenCalledOnce();
    expect(input.runProofOnUnfixedTree).not.toHaveBeenCalled();
    expect(input.runFullSuiteAfterFix).not.toHaveBeenCalled();
    expect(await readRegressionGuard(projectRoot, 'DEF-1')).toBeNull();
  });

  it('rejects a non-genuine proof without applying the fix', async () => {
    const input = baseInput({
      runProofOnUnfixedTree: vi.fn(async () => ({ passed: true, output: 'green already' })),
    });
    const result = await runFixProtocol(input);

    expect(result.status).toBe('rejected-proof-not-genuine');
    expect(input.applyFix).not.toHaveBeenCalled();
    expect(input.runFullSuiteAfterFix).not.toHaveBeenCalled();
    expect(await readRegressionGuard(projectRoot, 'DEF-1')).toBeNull();
  });

  it('rejects when the proof still fails after the fix', async () => {
    const input = baseInput({
      runProofOnFixedTree: vi.fn(async () => ({ passed: false, output: 'still broken' })),
    });
    const result = await runFixProtocol(input);

    expect(result.status).toBe('rejected-proof-still-failing');
    expect(input.applyFix).toHaveBeenCalledOnce();
    expect(await readRegressionGuard(projectRoot, 'DEF-1')).toBeNull();
  });

  it('rejects when the fix regresses a previously-passing check', async () => {
    const input = baseInput({
      runFullSuiteAfterFix: vi.fn(async () => [failing('was-green')]),
    });
    const result = await runFixProtocol(input);

    expect(result.status).toBe('rejected-regression');
    expect(result.regression?.newly_failing).toEqual(['was-green']);
    expect(await readRegressionGuard(projectRoot, 'DEF-1')).toBeNull();
  });
});
