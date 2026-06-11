import { describe, expect, it } from 'vitest';

import type { GateResult } from '@/core/types/verification.js';
import type { QualityRatchetResult, RatchetMeasureVerdict } from '@/core/types/quality-ratchet.js';
import { findingRowsFrom, gateResultsToRows, ratchetResultToRows } from '@/evidence/fan-in.js';

const ctx = { subjectDigest: 'subject-1', ts: '2026-06-11T00:00:00.000Z' };

describe('gateResultsToRows', () => {
  it('emits one graded row per gate, stamped with the subject', () => {
    const results: GateResult[] = [
      { gate: 'mutation-testing', passed: true, detail: 'all mutants killed' },
      { gate: 'spec-review', passed: false, detail: 'spec gap', remediation: 'fix' },
      { gate: 'ac-test-mapping', passed: false, inconclusive: true, detail: 'unknown' },
    ];
    const rows = gateResultsToRows(results, ctx);

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.engine === 'verification-gate')).toBe(true);
    expect(rows.every((r) => r.subject_digest === 'subject-1')).toBe(true);
    expect(rows[0]).toMatchObject({
      code: 'mutation-testing',
      verdict: 'pass',
      strength_class: 'deterministic',
    });
    expect(rows[1]).toMatchObject({
      code: 'spec-review',
      verdict: 'fail',
      strength_class: 'llm-judged',
    });
    expect(rows[2]).toMatchObject({
      code: 'ac-test-mapping',
      verdict: 'inconclusive',
      strength_class: 'blocked',
    });
  });
});

describe('ratchetResultToRows', () => {
  function verdict(overrides: Partial<RatchetMeasureVerdict>): RatchetMeasureVerdict {
    return {
      measure: 'dead_code',
      module: 'core',
      baseline_value: 0,
      current_value: 0,
      outcome: 'unchanged',
      confidence: 'mature',
      kind: 'dead_code',
      detail: 'held',
      ...overrides,
    };
  }

  it('returns nothing when no ratchet ran', () => {
    expect(ratchetResultToRows(undefined, ctx)).toEqual([]);
  });

  it('grades a blocked measure as Tier C even when the gate passed', () => {
    const result: QualityRatchetResult = {
      status: 'pass',
      lane: 'full',
      verdicts: [
        verdict({ measure: 'strictness', outcome: 'blocked', detail: 'no tsconfig' }),
        verdict({ measure: 'dead_code', outcome: 'regressed', detail: 'worse' }),
        verdict({ measure: 'tangledness', outcome: 'tightened', detail: 'better' }),
      ],
      blocking_regressions: [],
      excepted_regressions: [],
      tightened: [],
      captured_baseline: false,
      skipped_reason: null,
    };
    const rows = ratchetResultToRows(result, ctx);

    expect(rows[0]).toMatchObject({
      code: 'ratchet:strictness:core',
      verdict: 'blocked',
      strength_class: 'blocked',
    });
    expect(rows[1]).toMatchObject({
      code: 'ratchet:dead_code:core',
      verdict: 'fail',
      strength_class: 'deterministic',
    });
    expect(rows[2]).toMatchObject({
      code: 'ratchet:tangledness:core',
      verdict: 'pass',
      strength_class: 'deterministic',
    });
  });
});

describe('findingRowsFrom', () => {
  it('adapts content-addressed engine findings into rows', () => {
    const rows = findingRowsFrom(
      'traceability',
      [
        {
          code: 'TR-UNTESTED-PROMISE',
          verdict: 'fail',
          strength_class: 'deterministic',
          detail: 'AC-2',
        },
      ],
      ctx,
    );
    expect(rows[0]).toMatchObject({
      engine: 'traceability',
      code: 'TR-UNTESTED-PROMISE',
      verdict: 'fail',
      strength_class: 'deterministic',
      detail: 'AC-2',
    });
  });
});
