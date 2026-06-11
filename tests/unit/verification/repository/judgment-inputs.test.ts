import { describe, expect, it } from 'vitest';

import {
  computeAcTestMapping,
  computeImplementationReview,
  computeSpecReview,
} from '@/verification/repository/judgment-inputs.js';
import type { ForwardLink, TraceabilityMap } from '@/core/types/traceability.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import type { SpecReviewReport, SpecReviewDefect } from '@/compliance/types.js';

function forwardLink(overrides: Partial<ForwardLink> = {}): ForwardLink {
  return {
    promise_id: 'AC-1',
    source: 'acceptance-criterion',
    description: 'criterion',
    delivering_code: ['src/feature.ts'],
    proving_checks: ['tests/feature.test.ts'],
    proven: true,
    ...overrides,
  };
}

function makeMap(forward: ForwardLink[]): TraceabilityMap {
  return {
    schema_version: '1.0.0',
    generated_at: '2026-01-01T00:00:00.000Z',
    lane: 'full',
    mode: 'full',
    anchors_known: true,
    blocked_reason: null,
    forward,
    backward: [],
    findings: [],
    counts: {
      promises: forward.length,
      untested_promises: forward.filter((link) => !link.proven).length,
      delivers_promise: 0,
      shared_groundwork: 0,
      orphan_code: 0,
    },
  };
}

function decisionPacket(id: string): DecisionPacket {
  return {
    decision_id: id,
    category: 'architecture',
    question: 'Which approach?',
  } as DecisionPacket;
}

function specReview(defects: SpecReviewDefect[]): SpecReviewReport {
  return { metadata: {}, defects } as SpecReviewReport;
}

describe('computeAcTestMapping', () => {
  it('passes (nothing to map) when no traceability map is on record', () => {
    const signal = computeAcTestMapping(null);
    expect(signal).toMatchObject({ passed: true, inconclusive: false });
    expect(signal.detail).toMatch(/no acceptance criteria/i);
  });

  it('passes when the map carries no acceptance criteria', () => {
    const signal = computeAcTestMapping(
      makeMap([forwardLink({ source: 'obligation', promise_id: 'OBL-1' })]),
    );
    expect(signal.passed).toBe(true);
    expect(signal.inconclusive).toBe(false);
  });

  it('fails, naming the unmapped acceptance criteria', () => {
    const signal = computeAcTestMapping(
      makeMap([
        forwardLink({ promise_id: 'AC-1', proven: true }),
        forwardLink({ promise_id: 'AC-2', proven: false }),
      ]),
    );
    expect(signal.passed).toBe(false);
    expect(signal.inconclusive).toBe(false);
    expect(signal.detail).toContain('AC-2');
    expect(signal.detail).not.toContain('AC-1,');
  });

  it('passes when every acceptance criterion is proven', () => {
    const signal = computeAcTestMapping(makeMap([forwardLink({ proven: true })]));
    expect(signal.passed).toBe(true);
    expect(signal.detail).toMatch(/1 acceptance criteria/);
  });
});

describe('computeImplementationReview', () => {
  it('passes with no findings when there are no pending decisions', () => {
    const result = computeImplementationReview([]);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('fails with a blocking decision-violation per unresolved packet', () => {
    const result = computeImplementationReview([decisionPacket('D-1'), decisionPacket('D-2')]);
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({
      kind: 'decision-violation',
      severity: 'error',
      decision_id: 'D-1',
    });
    expect(result.findings[0].detail).toContain('D-1');
  });
});

describe('computeSpecReview', () => {
  it('fails on an unresolved critical defect', () => {
    const signal = computeSpecReview({
      specReview: specReview([
        { defect_id: 'SR-1', severity: 'critical', status: 'new' } as SpecReviewDefect,
      ]),
      hasFrozenSpec: true,
      codeChanged: true,
    });
    expect(signal.passed).toBe(false);
    expect(signal.detail).toContain('SR-1');
  });

  it('passes when the report has no unresolved critical defects', () => {
    const signal = computeSpecReview({
      specReview: specReview([
        { defect_id: 'SR-1', severity: 'critical', status: 'resolved' } as SpecReviewDefect,
        { defect_id: 'SR-2', severity: 'minor', status: 'new' } as SpecReviewDefect,
      ]),
      hasFrozenSpec: false,
      codeChanged: true,
    });
    expect(signal.passed).toBe(true);
    expect(signal.inconclusive).toBe(false);
  });

  it('passes when a frozen spec exists and there is no report', () => {
    const signal = computeSpecReview({
      specReview: null,
      hasFrozenSpec: true,
      codeChanged: true,
    });
    expect(signal.passed).toBe(true);
    expect(signal.inconclusive).toBe(false);
  });

  it('escalates (passed but inconclusive) when code changed with no spec on record', () => {
    const signal = computeSpecReview({
      specReview: null,
      hasFrozenSpec: false,
      codeChanged: true,
    });
    expect(signal.passed).toBe(true);
    expect(signal.inconclusive).toBe(true);
  });

  it('passes (nothing to review) for a no-code change with no spec', () => {
    const signal = computeSpecReview({
      specReview: null,
      hasFrozenSpec: false,
      codeChanged: false,
    });
    expect(signal.passed).toBe(true);
    expect(signal.inconclusive).toBe(false);
  });
});
