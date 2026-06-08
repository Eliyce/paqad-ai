import { describe, expect, it } from 'vitest';

import { computeReconnect, renderReconnectReport } from '@/planning/reconnect-check.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import type { ExecutionSlice, PlanningLane, VerificationCriterion } from '@/core/types/planning.js';

function criterion(id: string): VerificationCriterion {
  return {
    criterion_id: id,
    given: 'g',
    when: 'w',
    then: 't',
    proof_type: 'automated',
    proof_target: 'tests/unit/planning/generated.test.ts',
    status: 'covered',
    source: 'planned',
    linked_requirement_ids: ['FR-1'],
  };
}

function frozenSpec(criterionIds: string[]): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-104',
    spec_file: '.paqad/specs/S-104-build-in-small-pieces.md',
    spec_hash: 'hash',
    behaviour: [],
    acceptance_criteria: criterionIds.map(criterion),
    invariants: [],
    open_questions: [],
    frozen: { frozen_at: '2026-06-01T00:00:00.000Z', spec_hash: 'hash', signed_off_by: 'human' },
  };
}

function slice(
  overrides: Partial<ExecutionSlice> & Pick<ExecutionSlice, 'slice_id'>,
): ExecutionSlice {
  return {
    goal: 'build a slice',
    covers: [],
    depends_on: [],
    touches: ['src/planning/index.ts'],
    rollback_class: 'safe',
    ...overrides,
  };
}

const ALL_LANES: PlanningLane[] = ['graduated', 'full'];

describe('computeReconnect', () => {
  it('is coherent when every frozen criterion is owned by exactly one slice and proven', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1', 'AC-2']),
      slices: [
        slice({ slice_id: 'SL-1', covers: ['AC-1'] }),
        slice({ slice_id: 'SL-2', covers: ['AC-2'], depends_on: ['SL-1'] }),
      ],
      snapshot: { changed_files: [], covered_criteria: ['AC-1', 'AC-2'] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(true);
    expect(report.anchored).toBe(true);
    expect(report.frozen_criteria_total).toBe(2);
    expect(report.uncovered_criteria).toEqual([]);
  });

  it('refuses to reconnect against an unfrozen spec — there is no written anchor', () => {
    const spec = { ...frozenSpec(['AC-1']), frozen: null };
    const report = computeReconnect({
      spec,
      slices: [slice({ slice_id: 'SL-1', covers: ['AC-1'] })],
      snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
      lane: 'graduated',
    });

    expect(report.anchored).toBe(false);
    expect(report.coherent).toBe(false);
    expect(report.uncovered_criteria).toEqual(['AC-1']);
  });

  it('fails on a frozen criterion no slice covers (a deliberately-incomplete assembly)', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1', 'AC-2']),
      slices: [slice({ slice_id: 'SL-1', covers: ['AC-1'] })],
      snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(false);
    expect(report.uncovered_criteria).toEqual(['AC-2']);
  });

  it('fails on a covered-but-unproven criterion', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1']),
      slices: [slice({ slice_id: 'SL-1', covers: ['AC-1'] })],
      snapshot: { changed_files: [], covered_criteria: [] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(false);
    expect(report.unproven_criteria).toEqual(['AC-1']);
  });

  it('flags a criterion owned by more than one slice as a contradiction', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1']),
      slices: [
        slice({ slice_id: 'SL-1', covers: ['AC-1'] }),
        slice({ slice_id: 'SL-2', covers: ['AC-1'] }),
      ],
      snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(false);
    expect(report.contradictions[0]).toMatchObject({
      kind: 'double-owned',
      criterion_id: 'AC-1',
      slice_ids: ['SL-1', 'SL-2'],
    });
  });

  it('flags a slice claiming a criterion absent from the frozen spec as off-spec drift', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1']),
      slices: [slice({ slice_id: 'SL-1', covers: ['AC-1', 'AC-9'] })],
      snapshot: { changed_files: [], covered_criteria: ['AC-1', 'AC-9'] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(false);
    expect(report.contradictions).toEqual([
      expect.objectContaining({ kind: 'off-spec', criterion_id: 'AC-9', slice_ids: ['SL-1'] }),
    ]);
  });

  it('flags a slice wired onto a slice missing from the assembly', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1']),
      slices: [slice({ slice_id: 'SL-2', covers: ['AC-1'], depends_on: ['SL-1'] })],
      snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(false);
    expect(report.unwired_seams[0]).toMatchObject({
      slice_id: 'SL-2',
      depends_on: 'SL-1',
      kind: 'dangling',
    });
  });

  it('flags a slice wired onto an upstream whose criterion was never proven', () => {
    const report = computeReconnect({
      spec: frozenSpec(['AC-1', 'AC-2']),
      slices: [
        slice({ slice_id: 'SL-1', covers: ['AC-1'] }),
        slice({ slice_id: 'SL-2', covers: ['AC-2'], depends_on: ['SL-1'] }),
      ],
      snapshot: { changed_files: [], covered_criteria: ['AC-2'] },
      lane: 'graduated',
    });

    expect(report.coherent).toBe(false);
    expect(report.unwired_seams).toEqual([
      expect.objectContaining({ slice_id: 'SL-2', depends_on: 'SL-1', kind: 'upstream-unproven' }),
    ]);
  });

  it('escalates to an agent re-read on the full lane and stays structural otherwise', () => {
    for (const lane of ALL_LANES) {
      const report = computeReconnect({
        spec: frozenSpec(['AC-1']),
        slices: [slice({ slice_id: 'SL-1', covers: ['AC-1'] })],
        snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
        lane,
      });
      expect(report.review).toBe(lane === 'full' ? 'agent-re-read' : 'structural');
    }
  });
});

describe('renderReconnectReport', () => {
  it('renders a COHERENT checklist', () => {
    const rendered = renderReconnectReport(
      computeReconnect({
        spec: frozenSpec(['AC-1']),
        slices: [slice({ slice_id: 'SL-1', covers: ['AC-1'] })],
        snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
        lane: 'graduated',
      }),
    );

    expect(rendered).toContain('Result: COHERENT');
    expect(rendered).toContain('Every frozen criterion is owned by a slice (1/1)');
    expect(rendered).toContain('Review: structural');
  });

  it('names every incoherence on an INCOHERENT checklist', () => {
    const rendered = renderReconnectReport(
      computeReconnect({
        spec: frozenSpec(['AC-1', 'AC-2']),
        slices: [slice({ slice_id: 'SL-2', covers: ['AC-3'], depends_on: ['SL-1'] })],
        snapshot: { changed_files: [], covered_criteria: [] },
        lane: 'full',
      }),
    );

    expect(rendered).toContain('Result: INCOHERENT');
    expect(rendered).toContain('Uncovered criteria: AC-1, AC-2.');
    expect(rendered).toContain('Unwired seam:');
    expect(rendered).toContain('Contradiction:');
    expect(rendered).toContain('Review: agent-re-read');
  });

  it('explains the missing anchor when the spec is not frozen', () => {
    const rendered = renderReconnectReport(
      computeReconnect({
        spec: { ...frozenSpec(['AC-1']), frozen: null },
        slices: [slice({ slice_id: 'SL-1', covers: ['AC-1'] })],
        snapshot: { changed_files: [], covered_criteria: ['AC-1'] },
        lane: 'graduated',
      }),
    );

    expect(rendered).toContain('there is no written anchor to reconnect to');
  });
});
