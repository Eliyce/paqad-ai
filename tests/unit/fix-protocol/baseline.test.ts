import { describe, expect, it, vi } from 'vitest';

import { detectRegression, resolveGreenBaseline } from '@/fix-protocol/baseline.js';
import type { TestIssueSnapshot } from '@/core/types/token-efficiency.js';

const NOW = '2026-06-07T00:00:00.000Z';

function failing(testId: string): TestIssueSnapshot {
  return { test_id: testId, message: 'failed', status: 'failed' };
}

describe('resolveGreenBaseline', () => {
  it('reuses the last passing evidence when the tree is unchanged', () => {
    const rerun = vi.fn(() => [failing('should-not-run')]);
    const baseline = resolveGreenBaseline({
      last_evidence: { overall_status: 'pass', issues: [] },
      tree_changed_since_evidence: false,
      rerun,
      now: NOW,
    });
    expect(baseline.source).toBe('reused-evidence');
    expect(baseline.issues).toEqual([]);
    expect(rerun).not.toHaveBeenCalled();
  });

  it('re-runs when the tree changed since the evidence', () => {
    const rerun = vi.fn(() => [failing('t1')]);
    const baseline = resolveGreenBaseline({
      last_evidence: { overall_status: 'pass', issues: [] },
      tree_changed_since_evidence: true,
      rerun,
      now: NOW,
    });
    expect(baseline.source).toBe('rerun');
    expect(baseline.issues).toEqual([failing('t1')]);
    expect(rerun).toHaveBeenCalledOnce();
  });

  it('re-runs when the last evidence is failing', () => {
    const rerun = vi.fn(() => []);
    const baseline = resolveGreenBaseline({
      last_evidence: { overall_status: 'fail', issues: [failing('t1')] },
      tree_changed_since_evidence: false,
      rerun,
      now: NOW,
    });
    expect(baseline.source).toBe('rerun');
    expect(rerun).toHaveBeenCalledOnce();
  });

  it('re-runs when there is no prior evidence', () => {
    const rerun = vi.fn(() => []);
    const baseline = resolveGreenBaseline({
      last_evidence: null,
      tree_changed_since_evidence: false,
      rerun,
      now: NOW,
    });
    expect(baseline.source).toBe('rerun');
    expect(rerun).toHaveBeenCalledOnce();
  });
});

describe('detectRegression', () => {
  it('flags a previously-passing check that now fails', () => {
    const verdict = detectRegression([], [failing('was-green')]);
    expect(verdict.regressed).toBe(true);
    expect(verdict.newly_failing).toEqual(['was-green']);
  });

  it('does not count the once-failing proof flipping to passing', () => {
    // Baseline had the proof failing; after the fix nothing fails → no regression.
    const verdict = detectRegression([failing('proof')], []);
    expect(verdict.regressed).toBe(false);
    expect(verdict.newly_failing).toEqual([]);
  });

  it('reports a clean run as no regression', () => {
    const verdict = detectRegression([], []);
    expect(verdict.regressed).toBe(false);
  });

  it('flags a newly errored check', () => {
    const verdict = detectRegression([], [{ test_id: 'boom', message: 'err', status: 'errored' }]);
    expect(verdict.regressed).toBe(true);
    expect(verdict.newly_errored).toEqual(['boom']);
  });
});
