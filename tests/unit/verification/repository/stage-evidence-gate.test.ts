import { describe, expect, it } from 'vitest';

import { stageEvidenceGate } from '@/verification/repository/run-repository-verification.js';
import type { VerifyResult } from '@/stage-evidence/verify.js';

/** Build a VerifyResult with sane defaults for the field under test. */
function result(over: Partial<VerifyResult>): VerifyResult {
  return {
    verdict: 'incomplete',
    ok: false,
    blocked: false,
    live_marked: false,
    missing_stages: ['review', 'checks'],
    ordering_violations: [],
    redo_attempts: 0,
    change_key: 'ses#1',
    ...over,
  };
}

describe('stageEvidenceGate — mode-gated stage enforcement (buildout F4, RCA closure)', () => {
  // N1 fix: the working-tree diff count no longer gates. A committed change has a
  // clean tree (changedFileCount === 0) yet, if incomplete, must STILL fail —
  // otherwise the gate vacuously passes the moment the agent commits. The
  // empty-turn guard is a null result (from finalizeStageEvidence), not a zero diff.
  it('N1: fails a committed (zero-diff) incomplete change instead of vacuously passing', () => {
    const gate = stageEvidenceGate(result({}), 'hook-completion', 0, 'strict');
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('review');
  });

  it('returns null when there is no stage result (genuine no-op / read-only turn)', () => {
    expect(stageEvidenceGate(null, 'hook-completion', 5, 'strict')).toBeNull();
  });

  it('passes when every mandatory stage was recorded (complete), any mode', () => {
    for (const mode of ['off', 'warn', 'strict'] as const) {
      const gate = stageEvidenceGate(
        result({ verdict: 'complete', ok: true }),
        'hook-completion',
        3,
        mode,
      );
      expect(gate?.status, mode).toBe('pass');
    }
  });

  // THE FIX: strict fails an incomplete change at a local origin REGARDLESS of
  // live_marked. Before F4 this returned `skipped` (live_marked was always false),
  // which is exactly how a cannot-verify change shipped.
  it('strict: hard-FAILS an incomplete change at a local origin even when never live-marked', () => {
    for (const origin of ['hook-completion', 'git-backstop'] as const) {
      const gate = stageEvidenceGate(result({ live_marked: false }), origin, 4, 'strict');
      expect(gate?.status, origin).toBe('fail');
      expect(gate?.detail).toContain('review');
      expect(gate?.remediation).toBeTruthy();
    }
  });

  it('strict is the DEFAULT mode (omitted arg behaves as strict)', () => {
    const gate = stageEvidenceGate(result({ live_marked: false }), 'hook-completion', 4);
    expect(gate?.status).toBe('fail');
  });

  it('strict: a blocked verdict at a local origin also hard-fails', () => {
    const gate = stageEvidenceGate(
      result({ verdict: 'blocked', blocked: true }),
      'git-backstop',
      2,
      'strict',
    );
    expect(gate?.status).toBe('fail');
  });

  it('strict: stays informational (skipped) on CI — no committed local ledger', () => {
    const gate = stageEvidenceGate(result({ live_marked: true }), 'ci-backstop', 4, 'strict');
    expect(gate?.status).toBe('skipped');
  });

  it('warn: never fails — surfaces the incompleteness as a warning only', () => {
    const gate = stageEvidenceGate(result({ live_marked: false }), 'hook-completion', 4, 'warn');
    expect(gate?.status).toBe('skipped');
    expect(gate?.detail).toContain('stages_mode=warn');
  });

  it('off: disabled escape hatch — never fails even at a local origin', () => {
    const gate = stageEvidenceGate(result({ live_marked: false }), 'git-backstop', 4, 'off');
    expect(gate?.status).toBe('skipped');
    expect(gate?.detail).toContain('stages_mode=off');
  });
});
