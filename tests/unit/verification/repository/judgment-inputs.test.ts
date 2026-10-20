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
  it('AC-32: reads not required when there is no frozen spec', () => {
    const signal = computeAcTestMapping({ specFrozen: false, map: null });
    expect(signal).toEqual({
      outcome: 'not-required',
      passed: true,
      inconclusive: false,
      detail: 'No frozen spec, so no acceptance criteria to map.',
    });
  });

  it('AC-34: reads did not run when a frozen spec has no map, saying the map is missing', () => {
    const signal = computeAcTestMapping({ specFrozen: true, map: null });
    expect(signal).toMatchObject({ outcome: 'did-not-run', passed: true, inconclusive: false });
    expect(signal.detail).toContain('map is missing');
    expect(signal.detail).not.toContain('Acceptance criteria map to tests');

    const withWhy = computeAcTestMapping({ specFrozen: true, map: null, buildError: 'disk full' });
    expect(withWhy.detail).toContain('(disk full)');
  });

  it('AC-31: reads not required naming the visual and manual criteria when no automated ones exist', () => {
    const signal = computeAcTestMapping({
      specFrozen: true,
      map: makeMap([forwardLink({ source: 'obligation', promise_id: 'OBL-1' })]),
      visual: ['AC-1'],
      manual: ['AC-2'],
    });
    expect(signal).toMatchObject({ outcome: 'not-required', passed: true });
    expect(signal.detail).toContain('visual: AC-1');
    expect(signal.detail).toContain('manual: AC-2');
    expect(signal.detail).toContain('visual-evidence gate');

    const visualOnly = computeAcTestMapping({
      specFrozen: true,
      map: makeMap([]),
      visual: ['AC-3'],
    });
    expect(visualOnly.detail).toContain('(visual: AC-3)');
    const manualOnly = computeAcTestMapping({
      specFrozen: true,
      map: makeMap([]),
      manual: ['AC-4'],
    });
    expect(manualOnly.detail).toContain('(manual: AC-4)');
  });

  it('reads not required when the frozen spec has no criteria at all', () => {
    const signal = computeAcTestMapping({ specFrozen: true, map: makeMap([]) });
    expect(signal).toMatchObject({ outcome: 'not-required', passed: true });
    expect(signal.detail).toBe('The frozen spec has no automated acceptance criteria to map.');
  });

  it('AC-33: fails, naming every unproven automated criterion', () => {
    const signal = computeAcTestMapping({
      specFrozen: true,
      map: makeMap([
        forwardLink({ promise_id: 'AC-1', proven: true }),
        forwardLink({ promise_id: 'AC-2', proven: false }),
        forwardLink({ promise_id: 'AC-3', proven: false }),
      ]),
    });
    expect(signal).toMatchObject({ outcome: 'fail', passed: false, inconclusive: false });
    expect(signal.detail).toContain('AC-2, AC-3');
    expect(signal.detail).not.toContain('AC-1,');
  });

  it('AC-34: passes with the computed count when every automated criterion is proven', () => {
    const signal = computeAcTestMapping({
      specFrozen: true,
      map: makeMap([forwardLink({ proven: true }), forwardLink({ promise_id: 'AC-2' })]),
    });
    expect(signal).toMatchObject({ outcome: 'pass', passed: true });
    expect(signal.detail).toBe('All 2 automated acceptance criteria map to a proving test.');
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

describe('computeImplementationReview by when each decision was opened', () => {
  const EDIT = '2026-05-01T10:00:00.000Z';
  function opened(id: string, createdAt: string): DecisionPacket {
    return { ...decisionPacket(id), created_at: createdAt } as DecisionPacket;
  }

  it('blocks a decision opened before the last source edit and lists a later one as waiting', () => {
    const result = computeImplementationReview(
      [opened('D-early', '2026-05-01T09:00:00.000Z'), opened('D-late', '2026-05-01T11:00:00.000Z')],
      EDIT,
    );
    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.decision_id)).toEqual(['D-early']);
    expect(result.waiting).toEqual([
      { decision_id: 'D-late', category: 'architecture', question: 'Which approach?' },
    ]);
  });

  it('passes when every pending decision was opened after the last source edit', () => {
    const result = computeImplementationReview(
      [opened('D-late', '2026-05-01T11:00:00.000Z')],
      EDIT,
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.waiting).toHaveLength(1);
  });

  it('blocks a decision opened at the same moment as the last edit or with an unreadable time', () => {
    const result = computeImplementationReview(
      [opened('D-same', EDIT), opened('D-bad', 'not a date')],
      EDIT,
    );
    expect(result.findings).toHaveLength(2);
    expect(result.waiting).toEqual([]);
  });

  it('blocks every pending decision when the last edit time is unknown or unreadable', () => {
    for (const editedAt of [null, 'not a date']) {
      const result = computeImplementationReview(
        [opened('D-late', '2026-05-01T11:00:00.000Z')],
        editedAt,
      );
      expect(result.passed).toBe(false);
      expect(result.waiting).toEqual([]);
    }
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
