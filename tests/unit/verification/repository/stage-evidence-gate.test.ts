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

describe('stageEvidenceGate — deterministic stage enforcement (#247)', () => {
  it('AC3: returns null when there is no code diff (only on code change)', () => {
    expect(stageEvidenceGate(result({}), 'hook-completion', 0)).toBeNull();
  });

  it('returns null when there is no stage result', () => {
    expect(stageEvidenceGate(null, 'hook-completion', 5)).toBeNull();
  });

  it('AC2: passes when every mandatory stage was recorded (complete)', () => {
    const gate = stageEvidenceGate(
      result({ verdict: 'complete', ok: true, live_marked: true }),
      'hook-completion',
      3,
    );
    expect(gate?.status).toBe('pass');
  });

  it('AC1: hard-FAILS when the workflow was started but left incomplete, at a local origin', () => {
    for (const origin of ['hook-completion', 'git-backstop'] as const) {
      const gate = stageEvidenceGate(result({ live_marked: true }), origin, 4);
      expect(gate?.status, origin).toBe('fail');
      expect(gate?.detail).toContain('review');
      expect(gate?.remediation).toBeTruthy();
    }
  });

  it('AC4: stays informational (skipped) on CI, even when incomplete', () => {
    const gate = stageEvidenceGate(result({ live_marked: true }), 'ci-backstop', 4);
    expect(gate?.status).toBe('skipped');
  });

  it('never hard-fails when the workflow was never marked (informational only)', () => {
    // A project that has not adopted stage marking must not be broken by the gate.
    const gate = stageEvidenceGate(result({ live_marked: false }), 'hook-completion', 4);
    expect(gate?.status).toBe('skipped');
    expect(gate?.detail).toContain('not recorded');
  });

  it('blocked verdict at a local origin also hard-fails', () => {
    const gate = stageEvidenceGate(
      result({ verdict: 'blocked', blocked: true, live_marked: true }),
      'git-backstop',
      2,
    );
    expect(gate?.status).toBe('fail');
  });
});
