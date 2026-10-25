import { describe, expect, it } from 'vitest';

import { stageEvidenceGate } from '@/verification/repository/run-repository-verification.js';
import type { VerifyResult } from '@/stage-evidence/verify.js';

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
  it('N1: fails a committed (zero-diff) incomplete change instead of vacuously passing', () => {
    const gate = stageEvidenceGate(result({}), 'hook-completion', 0, 'strict');
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('review');
  });

  it('AC-3: names a stage left open at turn end and how to end it', () => {
    const gate = stageEvidenceGate(
      result({ live_marked: true, missing_stages: ['checks'], open_stages: ['checks'] }),
      'hook-completion',
      1,
      'strict',
    );
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('left open: [checks]');
    expect(gate?.remediation).toContain('paqad-ai stage end checks');
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

  it('AC-7: every skip (off, warn, a non-local seam) reads not required', () => {
    for (const [origin, mode] of [
      ['ci-backstop', 'strict'],
      ['hook-completion', 'warn'],
      ['git-backstop', 'off'],
    ] as const) {
      expect(stageEvidenceGate(result({ live_marked: true }), origin, 4, mode)?.skip_kind).toBe(
        'not-required',
      );
    }
  });
});
