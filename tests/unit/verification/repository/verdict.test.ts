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

describe('flag-on skip lines (issue #579)', () => {
  const skippedVisual = gate({
    name: 'visual-evidence' as VerificationEvidenceGate['name'],
    status: 'skipped',
    detail: 'not-frontend — no changed file matched a frontend surface.',
    skip_reason: 'not-frontend',
  });
  const gates = [gate({ name: 'change-completeness', status: 'pass' }), skippedVisual];

  it('AC-5: prints the skip line when the gate flag is on, and the counts do not move', () => {
    const withLine = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidence(gates),
      escalations: ['spec-review: no frozen spec on record'],
      evidencePath: null,
      flagOnGates: ['visual-evidence' as VerificationEvidenceGate['name']],
    });
    const without = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidence(gates),
      escalations: ['spec-review: no frozen spec on record'],
      evidencePath: null,
    });
    const lines = withLine.summary.split('\n');
    expect(lines).toContain('> ⚪ visual evidence: skipped (not-frontend)');
    // After the status lines, before the escalations.
    const skipAt = lines.indexOf('> ⚪ visual evidence: skipped (not-frontend)');
    expect(lines[skipAt - 1]).toContain('1/1 checks held');
    expect(lines[skipAt + 1]).toContain('needs a look');
    // Same ran/passed counts as the run without the line.
    expect(without.summary.split('\n')[1]).toBe(lines[1]);
    expect(withLine.gates.find((g) => g.gate === 'visual-evidence')?.skip_reason).toBe(
      'not-frontend',
    );
  });

  it('AC-12: prints no skip line when the flag is off', () => {
    const summary = formatVerdictSummary({
      ok: true,
      gates: [
        {
          gate: 'visual-evidence' as VerificationEvidenceGate['name'],
          status: 'skipped',
          detail: 'visual evidence is off (flag off or coding capability absent).',
          remediation: null,
          skip_reason: 'visual evidence is off',
        },
      ],
      escalations: [],
      flagOnGates: [],
    });
    expect(summary).not.toContain('skipped (');
  });

  it('falls back to the detail when a skipped gate carries no short reason', () => {
    const summary = formatVerdictSummary({
      ok: true,
      gates: [
        {
          gate: 'visual-evidence' as VerificationEvidenceGate['name'],
          status: 'skipped',
          detail: 'nothing to do',
          remediation: null,
        },
        {
          gate: 'visual-evidence' as VerificationEvidenceGate['name'],
          status: 'pass',
          detail: 'ok',
          remediation: null,
        },
      ],
      escalations: [],
      flagOnGates: ['visual-evidence' as VerificationEvidenceGate['name']],
    });
    expect(summary).toContain('> ⚪ visual evidence: skipped (nothing to do)');
    expect(summary.match(/skipped \(/g)).toHaveLength(1);
  });
});

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

  // Issue #472 — reconcile down: passing gates + a mandatory-stage gap reads Inconclusive.
  describe('mandatory-stage reconcile (#472)', () => {
    const passingGates = [
      {
        gate: 'change-completeness' as const,
        status: 'pass' as const,
        detail: 'ok',
        remediation: null,
      },
    ];

    it('downgrades a passing verdict to Inconclusive and names the unrecorded stages', () => {
      const summary = formatVerdictSummary({
        ok: true,
        gates: passingGates,
        escalations: [],
        unrecordedMandatoryStages: ['review', 'checks'],
      });
      expect(summary).toContain(PAQAD_VERDICT.inconclusive);
      expect(summary).not.toContain(PAQAD_VERDICT.pass);
      // The gates that held are still credited.
      expect(summary).toContain('1/1 checks held');
      // The offending stages are named.
      expect(summary).toContain('mandatory stage(s) not recorded: review, checks');
    });

    it('is byte-for-byte unchanged when the gap list is empty or absent', () => {
      const baseline = formatVerdictSummary({ ok: true, gates: passingGates, escalations: [] });
      expect(
        formatVerdictSummary({
          ok: true,
          gates: passingGates,
          escalations: [],
          unrecordedMandatoryStages: [],
        }),
      ).toBe(baseline);
      expect(baseline).toContain(PAQAD_VERDICT.pass);
      expect(baseline).not.toContain('not recorded');
    });

    it('ignores the gap list when a gate already failed (fail rendering is unchanged)', () => {
      const summary = formatVerdictSummary({
        ok: false,
        gates: [
          { gate: 'ac-test-mapping', status: 'fail', detail: 'AC-2 unproven', remediation: null },
        ],
        escalations: [],
        unrecordedMandatoryStages: ['review', 'checks'],
      });
      expect(summary).toContain(PAQAD_VERDICT.fail);
      expect(summary).not.toContain('mandatory stage(s) not recorded');
    });
  });
});
