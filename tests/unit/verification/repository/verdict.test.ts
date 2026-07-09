import { describe, expect, it } from 'vitest';

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import {
  buildRepositoryVerificationVerdict,
  formatVerdictSummary,
} from '@/verification/repository/verdict.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';

function gate(overrides: Partial<VerificationEvidenceGate>): VerificationEvidenceGate {
  return {
    name: 'change-completeness',
    status: 'pass',
    detail: 'ok',
    remediation: null,
    failures: [],
    ...overrides,
  };
}

function evidence(gates: VerificationEvidenceGate[]): VerificationEvidence {
  return {
    schema_version: '1.1.0',
    run_id: 'run-1',
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:00:01.000Z',
    overall_status: gates.some((g) => g.status === 'fail' || g.status === 'inconclusive')
      ? 'fail'
      : 'pass',
    first_failure_gate: gates.find((g) => g.status === 'fail')?.name ?? null,
    gates,
  };
}

describe('buildRepositoryVerificationVerdict', () => {
  it('is ok when no gate fails (skipped gates do not count)', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidence([
        gate({ name: 'change-completeness', status: 'pass' }),
        gate({ name: 'ac-test-mapping', status: 'pass' }),
        gate({ name: 'story-quality', status: 'skipped' }),
      ]),
      escalations: [],
      evidencePath: '/tmp/evidence.json',
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.evidence_path).toBe('/tmp/evidence.json');
    expect(verdict.summary).toContain(PAQAD_VERDICT.pass);
  });

  it('is not ok and names the failing gate when a gate fails', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'ci-backstop',
      evidence: evidence([
        gate({ name: 'change-completeness', status: 'pass' }),
        gate({ name: 'ac-test-mapping', status: 'fail', detail: 'AC-2 unproven' }),
      ]),
      escalations: [],
      evidencePath: null,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain(PAQAD_VERDICT.fail);
    expect(verdict.summary).toContain('ac-test-mapping');
    expect(verdict.summary).toContain('AC-2 unproven');
    expect(verdict.evidence_path).toBeNull();
  });

  it('is not ok when a run gate is inconclusive', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'git-backstop',
      evidence: evidence([
        gate({ name: 'spec-review', status: 'inconclusive', detail: 'unknown' }),
      ]),
      escalations: [],
      evidencePath: null,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain(PAQAD_VERDICT.inconclusive);
  });

  it('surfaces escalations in the summary even when ok', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidence([gate({ name: 'change-completeness', status: 'pass' })]),
      escalations: ['spec-review: no frozen spec on record'],
      evidencePath: null,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toContain('needs a look');
    expect(verdict.summary).toContain('no frozen spec');
  });
});

describe('formatVerdictSummary', () => {
  it('reports the gate tally on a clean pass', () => {
    const summary = formatVerdictSummary({
      ok: true,
      gates: [
        { gate: 'change-completeness', status: 'pass', detail: 'ok', remediation: null },
        { gate: 'story-quality', status: 'skipped', detail: 'n/a', remediation: null },
      ],
      escalations: [],
    });
    expect(summary).toContain(PAQAD_VERDICT.pass);
    expect(summary).toContain('1/1 checks held');
  });

  it('names both failing and inconclusive gates under "Needs your attention"', () => {
    const summary = formatVerdictSummary({
      ok: false,
      gates: [
        { gate: 'ac-test-mapping', status: 'fail', detail: 'AC-2 unproven', remediation: null },
        {
          gate: 'spec-review',
          status: 'inconclusive',
          detail: 'no frozen spec',
          remediation: null,
        },
      ],
      escalations: [],
    });
    expect(summary).toContain(PAQAD_VERDICT.fail);
    expect(summary).toContain('ac-test-mapping');
    expect(summary).toContain('spec-review');
  });

  it('reads "Inconclusive" when only inconclusive gates ran', () => {
    const summary = formatVerdictSummary({
      ok: false,
      gates: [
        { gate: 'spec-review', status: 'inconclusive', detail: 'unknown', remediation: null },
      ],
      escalations: [],
    });
    expect(summary).toContain(PAQAD_VERDICT.inconclusive);
    expect(summary).toContain('spec-review');
  });
});
