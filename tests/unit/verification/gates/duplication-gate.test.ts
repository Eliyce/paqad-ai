import { describe, expect, it } from 'vitest';

import { DuplicationGate } from '@/verification/gates/duplication.js';
import { writeDuplicationReport, buildDuplicationReport } from '@/duplication/report.js';
import type { DuplicationConfig } from '@/duplication/config.js';
import type { DuplicationFinding } from '@/duplication/types.js';
import type { VerificationContext } from '@/core/types/verification.js';

import { makeGitProject } from '../../duplication/helpers.js';

function context(projectRoot: string): VerificationContext {
  return { project_root: projectRoot, changed_files: ['src/stamp.ts'] } as VerificationContext;
}

function finding(kind: DuplicationFinding['kind']): DuplicationFinding {
  return {
    file: 'src/stamp.ts',
    line_range: { start: 1, end: 8 },
    matched_file: 'src/dates.ts',
    matched_symbol: 'formatIsoDate',
    matched_line_range: { start: 1, end: 8 },
    similarity: kind === 'deterministic' ? 0.95 : 0.85,
    matched_callers: 3,
    corroborated: false,
    kind,
    message: 'msg',
  };
}

function writeReport(
  root: string,
  findings: DuplicationFinding[],
  mode: DuplicationConfig['mode'],
): void {
  writeDuplicationReport(
    root,
    buildDuplicationReport({
      findings,
      config: { mode, similarityThreshold: 0.9, minLines: 8 },
      elapsedMs: 1,
      now: 'x',
    }),
  );
}

describe('DuplicationGate', () => {
  it('is inert (passes) with no report', async () => {
    const root = makeGitProject();
    const result = await new DuplicationGate().check(context(root));
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('inert');
  });

  it('passes with a clean report', async () => {
    const root = makeGitProject();
    writeReport(root, [], 'strict');
    const result = await new DuplicationGate().check(context(root));
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('No new code near-copies');
  });

  it('AC-4: strict mode with a deterministic finding FAILS', async () => {
    const root = makeGitProject();
    writeReport(root, [finding('deterministic')], 'strict');
    const result = await new DuplicationGate().check(context(root));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('near-copy');
    expect(result.detail).toContain('src/stamp.ts near formatIsoDate');
    expect(result.remediation).toContain('create-vs-reuse');
  });

  it('AC-4: warn mode passes but surfaces the finding count', async () => {
    const root = makeGitProject();
    writeReport(root, [finding('deterministic')], 'warn');
    const result = await new DuplicationGate().check(context(root));
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('warn mode, not blocking');
  });

  it('AC-4: a heuristic-only finding never blocks, even in strict', async () => {
    const root = makeGitProject();
    writeReport(root, [finding('heuristic')], 'strict');
    const result = await new DuplicationGate().check(context(root));
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('1 near-copy flagged');
  });

  it('pluralizes the count for multiple deterministic findings', async () => {
    const root = makeGitProject();
    const second = { ...finding('deterministic'), line_range: { start: 20, end: 27 } };
    writeReport(root, [finding('deterministic'), second], 'strict');
    const result = await new DuplicationGate().check(context(root));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('2 near-copies');
  });
});
