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

describe('flag-on skip lines', () => {
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
    expect(lines).toContain('> ⚪ visual evidence: not required (not-frontend)');
    const skipAt = lines.indexOf('> ⚪ visual evidence: not required (not-frontend)');
    expect(lines[skipAt - 1]).toContain('1/1 checks held');
    expect(lines[skipAt + 1]).toContain('needs a look');
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
    expect(summary).not.toContain('not required (');
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
    expect(summary).toContain('> ⚪ visual evidence: not required (nothing to do)');
    expect(summary.match(/not required \(/g)).toHaveLength(1);
  });
});

describe('did-not-run and not-required lines', () => {
  it('AC-7: shows every did-not-run gate, grouped by reason, and keeps it out of the counts', () => {
    const summary = formatVerdictSummary({
      ok: true,
      gates: [
        { gate: 'change-completeness', status: 'pass', detail: 'ok', remediation: null },
        {
          gate: 'story-quality',
          status: 'skipped',
          detail: 'Gate did not run.',
          remediation: null,
          skip_reason: 'not checked in this run',
          skip_kind: 'did-not-run',
        },
        {
          gate: 'database-quality',
          status: 'skipped',
          detail: 'Gate did not run.',
          remediation: null,
          skip_reason: 'not checked in this run',
          skip_kind: 'did-not-run',
        },
        {
          gate: 'mutation-testing',
          status: 'skipped',
          detail: 'Mutation testing did not run: no mutation tool is configured for this stack.',
          remediation: null,
          skip_kind: 'did-not-run',
        },
        {
          gate: 'extension-surface',
          status: 'skipped',
          detail: 'Not required: no public export barrel changed.',
          remediation: null,
          skip_kind: 'not-required',
        },
      ],
      escalations: [],
    });
    const lines = summary.split('\n');
    expect(lines[0]).toContain(PAQAD_VERDICT.pass);
    expect(lines[1]).toContain('1/1 checks held');
    expect(lines).toContain(
      '> ⚪ story quality, database quality: did not run (not checked in this run)',
    );
    expect(lines).toContain(
      '> ⚪ mutation testing: Mutation testing did not run: no mutation tool is configured for this stack.',
    );
    expect(summary).not.toContain('extension surface');
  });

  it('AC-7: a flag-on gate that did not run reads did not run, not not required', () => {
    const summary = formatVerdictSummary({
      ok: true,
      gates: [
        {
          gate: 'visual-evidence' as VerificationEvidenceGate['name'],
          status: 'skipped',
          detail: 'no visual evidence to capture (no-capture-script).',
          remediation: null,
          skip_reason: 'no capture script',
          skip_kind: 'did-not-run',
        },
      ],
      escalations: [],
      flagOnGates: ['visual-evidence' as VerificationEvidenceGate['name']],
    });
    expect(summary).toContain('> ⚪ visual evidence: did not run (no capture script)');
    expect(summary).not.toContain('not required');
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

  describe('mandatory-stage reconcile', () => {
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
      expect(summary).toContain('1/1 checks held');
      expect(summary).toContain('No record yet for: Review, Checks');
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
      expect(summary).not.toContain('No record yet for');
    });
  });
});

describe('waiting decision lines', () => {
  const waiting = [
    { decision_id: 'D-01JWAIT', category: 'architecture', question: 'Which approach?' },
  ];

  it('prints one skipped-glyph line per waiting decision without moving the counts or the word', () => {
    const gates = [
      {
        gate: 'change-completeness' as const,
        status: 'pass' as const,
        detail: 'ok',
        remediation: null,
      },
    ];
    const without = formatVerdictSummary({ ok: true, gates, escalations: [] });
    const withWaiting = formatVerdictSummary({
      ok: true,
      gates,
      escalations: [],
      waitingDecisions: waiting,
    });
    expect(withWaiting).toContain(PAQAD_VERDICT.pass);
    expect(withWaiting).toContain('1/1 checks held for you.');
    expect(withWaiting.split('\n')).toEqual([
      ...without.split('\n'),
      '> ⚪ a decision is waiting for you: D-01JWAIT (architecture): Which approach?',
    ]);
  });

  it('passes waiting decisions through the verdict builder', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: evidence([gate({})]),
      escalations: [],
      evidencePath: null,
      waitingDecisions: waiting,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toContain('a decision is waiting for you: D-01JWAIT');
  });
});
