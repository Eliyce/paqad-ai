import { describe, expect, it } from 'vitest';

import type { FeatureSpec } from '@/core/types/feature-spec.js';
import type { SpecReviewReport } from '@/compliance/types.js';
import { evaluateSpecFreeze, freezeSpec, isFrozenSpecStale } from '@/spec/spec-freeze.js';

function frozenReadySpec(overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-102',
    spec_file: '.paqad/specs/S-102.md',
    spec_hash: 'hash-1',
    behaviour: ['FR-1: does a thing'],
    acceptance_criteria: [
      {
        criterion_id: 'AC-1',
        given: 'a',
        when: 'b',
        then: 'c',
        proof_type: 'automated',
        status: 'uncovered',
        source: 'planned',
        linked_requirement_ids: [],
      },
    ],
    invariants: [
      { invariant_id: 'INV-1', statement: 'never break', source: 'authored', confirmed: true },
    ],
    open_questions: [],
    frozen: null,
    ...overrides,
  };
}

function reviewWith(severity: 'critical' | 'major', status: 'new' | 'resolved'): SpecReviewReport {
  return {
    metadata: {
      spec_file: '.paqad/specs/S-102.md',
      spec_hash: 'hash-1',
      reviewed_at: '2026-06-07T00:00:00Z',
      defect_count: 1,
      schema_version: 1,
    },
    defects: [
      {
        defect_id: 'SD-1',
        category: 'contradiction',
        severity,
        description: 'conflict',
        locations: [],
        suggested_resolution: 'fix it',
        affected_obligation_ids: null,
        status,
      },
    ],
    pattern_advisories: [],
  };
}

describe('evaluateSpecFreeze', () => {
  it('allows freeze when all three sections are present and clean', () => {
    expect(evaluateSpecFreeze(frozenReadySpec())).toEqual({ can_freeze: true, blockers: [] });
  });

  it('blocks when any of behaviour / acceptance / invariants is empty', () => {
    const result = evaluateSpecFreeze(
      frozenReadySpec({ behaviour: [], acceptance_criteria: [], invariants: [] }),
    );
    expect(result.can_freeze).toBe(false);
    expect(result.blockers).toEqual([
      'Spec has no behaviour statements.',
      'Spec has no acceptance criteria.',
      'Spec has no invariants.',
    ]);
  });

  it('blocks on an unconfirmed invariant', () => {
    const result = evaluateSpecFreeze(
      frozenReadySpec({
        invariants: [
          { invariant_id: 'INV-1', statement: 'x', source: 'compiled-rule', confirmed: false },
        ],
      }),
    );
    expect(result.can_freeze).toBe(false);
    expect(result.blockers).toContain('Invariant INV-1 is not human-confirmed.');
  });

  it('blocks on an open question', () => {
    const result = evaluateSpecFreeze(frozenReadySpec({ open_questions: ['Q1: unresolved?'] }));
    expect(result.blockers).toContain('Open question unresolved: Q1: unresolved?');
  });

  it('blocks on a missing proof_type', () => {
    const spec = frozenReadySpec();
    spec.acceptance_criteria[0]!.proof_type = '' as never;
    const result = evaluateSpecFreeze(spec);
    expect(result.blockers).toContain('Acceptance criterion AC-1 has no proof_type.');
  });

  it('blocks on an open critical spec-review defect but ignores resolved or non-critical ones', () => {
    expect(evaluateSpecFreeze(frozenReadySpec(), reviewWith('critical', 'new')).can_freeze).toBe(
      false,
    );
    expect(
      evaluateSpecFreeze(frozenReadySpec(), reviewWith('critical', 'resolved')).can_freeze,
    ).toBe(true);
    expect(evaluateSpecFreeze(frozenReadySpec(), reviewWith('major', 'new')).can_freeze).toBe(true);
  });
});

describe('freezeSpec', () => {
  it('stamps frozen metadata when the spec is freezable', () => {
    const frozen = freezeSpec(frozenReadySpec(), {
      signed_off_by: 'haider',
      frozen_at: '2026-06-07T12:00:00Z',
    });
    expect(frozen.frozen).toEqual({
      frozen_at: '2026-06-07T12:00:00Z',
      spec_hash: 'hash-1',
      signed_off_by: 'haider',
    });
  });

  it('throws when the spec has blockers', () => {
    expect(() =>
      freezeSpec(frozenReadySpec({ open_questions: ['Q1: nope'] }), {
        signed_off_by: 'haider',
        frozen_at: '2026-06-07T12:00:00Z',
      }),
    ).toThrow(/Cannot freeze spec S-102/);
  });
});

describe('isFrozenSpecStale', () => {
  it('is false for an unfrozen spec', () => {
    expect(isFrozenSpecStale(frozenReadySpec(), 'whatever')).toBe(false);
  });

  it('detects a changed source hash after freeze', () => {
    const frozen = freezeSpec(frozenReadySpec(), {
      signed_off_by: 'haider',
      frozen_at: '2026-06-07T12:00:00Z',
    });
    expect(isFrozenSpecStale(frozen, 'hash-1')).toBe(false);
    expect(isFrozenSpecStale(frozen, 'hash-2')).toBe(true);
  });
});
