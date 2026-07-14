import { describe, expect, it } from 'vitest';

import {
  IN_TOTO_STATEMENT_TYPE,
  PAQAD_VSA_PREDICATE_TYPE,
  type EvidenceLedgerRow,
} from '@/core/types/evidence-ledger.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import {
  buildInTotoStatement,
  deriveVerificationResult,
  summarizeGradedEvidence,
} from '@/evidence/receipt/statement.js';

function row(overrides: Partial<EvidenceLedgerRow>): EvidenceLedgerRow {
  return buildEvidenceRow({
    ts: '2026-06-11T00:00:00.000Z',
    engine: 'verification-gate',
    code: 'mutation-testing',
    subject_digest: 'subject-1',
    verdict: 'pass',
    strength_class: 'deterministic',
    ...overrides,
  });
}

describe('summarizeGradedEvidence', () => {
  it('splits passes by strength class and never pools them', () => {
    const summary = summarizeGradedEvidence([
      row({ strength_class: 'deterministic', verdict: 'pass' }),
      row({ strength_class: 'deterministic', verdict: 'pass', code: 'ac-test-mapping' }),
      row({ strength_class: 'llm-judged', verdict: 'pass', code: 'spec-review' }),
      row({ strength_class: 'llm-judged', verdict: 'fail', code: 'implementation-review' }),
      row({ strength_class: 'blocked', verdict: 'blocked', code: 'ratchet:strictness:core' }),
      row({ strength_class: 'blocked', verdict: 'inconclusive', code: 'behavioral-correctness' }),
    ]);

    expect(summary).toEqual({
      deterministic: { pass: 2, fail: 0 },
      llm_judged: { pass: 1, fail: 1 },
      blocked: 1,
      inconclusive: 1,
    });
  });
});

describe('deriveVerificationResult', () => {
  it('PASSES only when nothing failed, blocked, or was inconclusive', () => {
    expect(
      deriveVerificationResult({
        deterministic: { pass: 5, fail: 0 },
        llm_judged: { pass: 2, fail: 0 },
        blocked: 0,
        inconclusive: 0,
      }),
    ).toBe('PASSED');
  });

  it('is INCONCLUSIVE (not FAILED) when a measure was merely blocked (#368 AC-D2)', () => {
    // A `blocked` row is a measure that could not RUN (unwired/absent tooling), not a
    // failure. Reporting FAILED here manufactured a false alarm from an unwired ratchet.
    expect(
      deriveVerificationResult({
        deterministic: { pass: 9, fail: 0 },
        llm_judged: { pass: 2, fail: 0 },
        blocked: 3,
        inconclusive: 0,
      }),
    ).toBe('INCONCLUSIVE');
  });

  it('is INCONCLUSIVE when a measure could not be judged (inconclusive row)', () => {
    expect(
      deriveVerificationResult({
        deterministic: { pass: 5, fail: 0 },
        llm_judged: { pass: 2, fail: 0 },
        blocked: 0,
        inconclusive: 1,
      }),
    ).toBe('INCONCLUSIVE');
  });

  it('a real failure DOMINATES a couldn’t-verify: fail + blocked still FAILS', () => {
    expect(
      deriveVerificationResult({
        deterministic: { pass: 4, fail: 1 },
        llm_judged: { pass: 2, fail: 0 },
        blocked: 3,
        inconclusive: 2,
      }),
    ).toBe('FAILED');
  });
});

describe('buildInTotoStatement', () => {
  it('carries per-file subjects and a graded VSA predicate', () => {
    const statement = buildInTotoStatement({
      fileDigests: [
        { name: 'src/a.ts', sha256: 'aaa' },
        { name: 'src/b.ts', sha256: 'bbb' },
      ],
      rows: [
        row({ strength_class: 'deterministic', verdict: 'pass' }),
        row({ strength_class: 'llm-judged', verdict: 'fail', code: 'spec-review' }),
      ],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
    });

    expect(statement._type).toBe(IN_TOTO_STATEMENT_TYPE);
    expect(statement.predicateType).toBe(PAQAD_VSA_PREDICATE_TYPE);
    expect(statement.subject).toEqual([
      { name: 'src/a.ts', digest: { sha256: 'aaa' } },
      { name: 'src/b.ts', digest: { sha256: 'bbb' } },
    ]);
    expect(statement.predicate.verifier).toEqual({ id: 'https://paqad.ai', version: '1.2.3' });
    expect(statement.predicate.verification_result).toBe('FAILED');
    expect(statement.predicate.graded_results.llm_judged.fail).toBe(1);
    expect(statement.predicate.evidence_by_engine['verification-gate']).toBe(2);
    expect(statement.predicate.rows).toHaveLength(2);
  });

  it('reads INCONCLUSIVE end-to-end when every real gate passed but ratchet measures were blocked (#368 AC-D2)', () => {
    // The exact shape observed in this repo's own ledger: 9 deterministic + 2 llm-judged
    // passes, plus 3 quality-ratchet measures that could not run ("tool-not-wired").
    // Before AC-D2 this produced a FALSE `FAILED`; it must read `INCONCLUSIVE`.
    const rows: EvidenceLedgerRow[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        row({ strength_class: 'deterministic', verdict: 'pass', code: `det-${i}` }),
      ),
      row({ strength_class: 'llm-judged', verdict: 'pass', code: 'spec-review' }),
      row({ strength_class: 'llm-judged', verdict: 'pass', code: 'implementation-review' }),
      row({ strength_class: 'blocked', verdict: 'blocked', code: 'ratchet:dead_code:(project)' }),
      row({ strength_class: 'blocked', verdict: 'blocked', code: 'ratchet:tangledness:(project)' }),
      row({
        strength_class: 'blocked',
        verdict: 'blocked',
        code: 'ratchet:risky_patterns:(project)',
      }),
    ];
    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows,
      verifierVersion: '1.58.0',
      timeVerified: '2026-07-14T00:00:00.000Z',
    });
    expect(statement.predicate.verification_result).toBe('INCONCLUSIVE');
    expect(statement.predicate.graded_results).toMatchObject({
      deterministic: { pass: 9, fail: 0 },
      llm_judged: { pass: 2, fail: 0 },
      blocked: 3,
    });
  });

  it('omits change_authorship entirely when none is supplied', () => {
    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [row({})],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
    });
    expect('change_authorship' in statement.predicate).toBe(false);
  });

  it('folds change_authorship into the predicate when supplied', () => {
    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [row({})],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
      authorship: {
        agent: 'cursor',
        model: 'gpt-5',
        provider: 'openai',
        model_id: 'openai/gpt-5',
        accepting_human: { name: 'Jane', email: 'jane@example.com' },
        provenance: 'declared',
      },
    });
    expect(statement.predicate.change_authorship).toMatchObject({
      agent: 'cursor',
      model_id: 'openai/gpt-5',
      provenance: 'declared',
    });
  });

  // Issues #122 / #123 — both new fields stay omitted when absent so prior
  // receipts remain byte-identical, and fold in cleanly when supplied.
  it('omits compliance_citations and reproducibility when absent (byte-identical)', () => {
    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [row({})],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
    });
    expect('compliance_citations' in statement.predicate).toBe(false);
    expect('reproducibility' in statement.predicate).toBe(false);
  });

  it('omits compliance_citations when the array is empty', () => {
    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [row({})],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
      complianceCitations: [],
    });
    expect('compliance_citations' in statement.predicate).toBe(false);
  });

  it('folds compliance_citations and reproducibility into the predicate when supplied', () => {
    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [row({})],
      verifierVersion: '1.2.3',
      timeVerified: '2026-06-11T00:00:00.000Z',
      complianceCitations: [
        {
          framework_id: 'eu-ai-act',
          framework_title: 'EU AI Act',
          clause_id: 'Art.15',
          clause_title: 'Robustness',
          gate: 'mutation-testing',
          relation: 'subset-of',
          evidence_strength: 'partial',
          disclaimer: 'evidence toward, not compliance',
        },
      ],
      reproducibility: {
        context_hash: 'deadbeef',
        determinism: 'input-replay',
        algo_version: 1,
        replayable: true,
      },
    });
    expect(statement.predicate.compliance_citations).toHaveLength(1);
    expect(statement.predicate.compliance_citations?.[0]?.clause_id).toBe('Art.15');
    expect(statement.predicate.reproducibility?.determinism).toBe('input-replay');
  });
});
