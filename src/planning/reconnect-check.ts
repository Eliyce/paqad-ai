import type { FeatureSpec } from '@/core/types/feature-spec.js';
import type { ExecutionSlice, PlanningLane, PlanVsActualSnapshot } from '@/core/types/planning.js';

/**
 * A cross-slice seam that the assembled work left unwired (issue #104). A slice
 * either depends on another that is absent from the assembly (`dangling`), or it
 * was wired onto an upstream slice whose own frozen criterion was never proven
 * (`upstream-unproven`).
 */
export interface ReconnectSeam {
  slice_id: string;
  depends_on: string;
  kind: 'dangling' | 'upstream-unproven';
  detail: string;
}

/**
 * Two slices disagree about the assembly (issue #104): the same frozen
 * criterion is owned by more than one slice (`double-owned`), or a slice claims
 * a criterion that is not in the frozen spec at all (`off-spec`).
 */
export interface ReconnectContradiction {
  kind: 'double-owned' | 'off-spec';
  criterion_id: string;
  slice_ids: string[];
  detail: string;
}

export interface ReconnectReport {
  coherent: boolean;
  /** False when the spec was never frozen — the check has no written anchor to read. */
  anchored: boolean;
  /** How the reconnect was judged: structural by default, agent re-read on the full lane. */
  review: 'structural' | 'agent-re-read';
  frozen_criteria_total: number;
  /** Frozen criteria no slice covers — coverage gaps against the whole-feature spec. */
  uncovered_criteria: string[];
  /** Frozen criteria a slice covers but whose proof did not pass — built, not proven. */
  unproven_criteria: string[];
  unwired_seams: ReconnectSeam[];
  contradictions: ReconnectContradiction[];
}

export interface ReconnectInput {
  spec: FeatureSpec;
  slices: ExecutionSlice[];
  snapshot: PlanVsActualSnapshot;
  lane: PlanningLane;
}

/**
 * The reconnect-to-whole check (issue #104). After the thin slices are built,
 * this confirms the assembled pieces satisfy the **frozen** whole-feature spec —
 * not merely that each slice passed alone. It is a real check, not a stamp: it
 * fails on a coverage gap, an unproven criterion, an unwired cross-slice seam,
 * or two slices that contradict each other.
 *
 * It anchors on the written frozen spec, never on the agent's memory of the
 * feature (the brief's core point — an agent's grip on the whole fades on long
 * jobs). An unfrozen spec yields `anchored: false` and is never coherent.
 *
 * Strength scales with lane (Open Decision 1): structural AC-coverage + seam
 * checks by default, escalating to an agent re-read of the spec on the `full`
 * lane.
 */
export function computeReconnect(input: ReconnectInput): ReconnectReport {
  const review: ReconnectReport['review'] = input.lane === 'full' ? 'agent-re-read' : 'structural';
  const frozenCriterionIds = input.spec.acceptance_criteria.map(
    (criterion) => criterion.criterion_id,
  );

  if (input.spec.frozen === null) {
    return {
      coherent: false,
      anchored: false,
      review,
      frozen_criteria_total: frozenCriterionIds.length,
      uncovered_criteria: [...frozenCriterionIds],
      unproven_criteria: [],
      unwired_seams: [],
      contradictions: [],
    };
  }

  const frozenSet = new Set(frozenCriterionIds);
  const provenSet = new Set(input.snapshot.covered_criteria ?? []);
  const sliceIds = new Set(input.slices.map((slice) => slice.slice_id));

  const owners = ownersByCriterion(input.slices);

  const uncovered: string[] = [];
  const unproven: string[] = [];
  for (const criterionId of frozenCriterionIds) {
    const ownerSlices = owners.get(criterionId) ?? [];
    if (ownerSlices.length === 0) {
      uncovered.push(criterionId);
      continue;
    }
    if (!provenSet.has(criterionId)) {
      unproven.push(criterionId);
    }
  }

  const contradictions = collectContradictions(owners, frozenSet);
  const unwiredSeams = collectSeams(input.slices, sliceIds, owners, frozenSet, provenSet);

  const coherent =
    uncovered.length === 0 &&
    unproven.length === 0 &&
    unwiredSeams.length === 0 &&
    contradictions.length === 0;

  return {
    coherent,
    anchored: true,
    review,
    frozen_criteria_total: frozenCriterionIds.length,
    uncovered_criteria: uncovered,
    unproven_criteria: unproven,
    unwired_seams: unwiredSeams,
    contradictions,
  };
}

/**
 * Renders the reconnect result as a human-readable checklist that names exactly
 * what does not fit the whole-feature spec, mirroring the Definition-of-Done
 * checklist (issue #102) so a reader sees the specific gap, not a vague verdict.
 */
export function renderReconnectReport(report: ReconnectReport): string {
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');
  const proven = report.frozen_criteria_total - report.uncovered_criteria.length;

  const lines = [
    '# Reconnect to the whole',
    '',
    `- [${mark(report.anchored)}] Anchored on the frozen feature spec`,
    `- [${mark(report.uncovered_criteria.length === 0)}] Every frozen criterion is owned by a slice (${proven}/${report.frozen_criteria_total})`,
    `- [${mark(report.unproven_criteria.length === 0)}] Every covered criterion is proven`,
    `- [${mark(report.unwired_seams.length === 0)}] No cross-slice seam left unwired`,
    `- [${mark(report.contradictions.length === 0)}] No slice contradicts another`,
    '',
    `Review: ${report.review}`,
    `Result: ${report.coherent ? 'COHERENT' : 'INCOHERENT'}`,
  ];

  if (!report.anchored) {
    lines.push(
      'Blocked: the feature spec is not frozen; there is no written anchor to reconnect to.',
    );
  }
  if (report.uncovered_criteria.length > 0) {
    lines.push(`Uncovered criteria: ${report.uncovered_criteria.join(', ')}.`);
  }
  if (report.unproven_criteria.length > 0) {
    lines.push(`Unproven criteria: ${report.unproven_criteria.join(', ')}.`);
  }
  for (const seam of report.unwired_seams) {
    lines.push(`Unwired seam: ${seam.detail}`);
  }
  for (const contradiction of report.contradictions) {
    lines.push(`Contradiction: ${contradiction.detail}`);
  }

  return `${lines.join('\n')}\n`;
}

function ownersByCriterion(slices: ExecutionSlice[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const slice of slices) {
    for (const cover of slice.covers) {
      if (!/^AC-\d+$/.test(cover)) {
        continue;
      }
      const bucket = owners.get(cover) ?? [];
      bucket.push(slice.slice_id);
      owners.set(cover, bucket);
    }
  }
  return owners;
}

function collectContradictions(
  owners: Map<string, string[]>,
  frozenSet: Set<string>,
): ReconnectContradiction[] {
  const contradictions: ReconnectContradiction[] = [];
  for (const [criterionId, ownerSlices] of owners) {
    if (!frozenSet.has(criterionId)) {
      contradictions.push({
        kind: 'off-spec',
        criterion_id: criterionId,
        slice_ids: [...ownerSlices].sort(compareIds),
        detail: `${criterionId} is covered by ${ownerSlices.join(', ')} but is not in the frozen spec.`,
      });
      continue;
    }
    if (ownerSlices.length > 1) {
      contradictions.push({
        kind: 'double-owned',
        criterion_id: criterionId,
        slice_ids: [...ownerSlices].sort(compareIds),
        detail: `${criterionId} is owned by more than one slice (${ownerSlices.join(', ')}); ownership is ambiguous.`,
      });
    }
  }
  return contradictions.sort((left, right) => compareIds(left.criterion_id, right.criterion_id));
}

function collectSeams(
  slices: ExecutionSlice[],
  sliceIds: Set<string>,
  owners: Map<string, string[]>,
  frozenSet: Set<string>,
  provenSet: Set<string>,
): ReconnectSeam[] {
  const frozenCoveredBySlice = new Map<string, string[]>();
  for (const [criterionId, ownerSlices] of owners) {
    if (!frozenSet.has(criterionId)) {
      continue;
    }
    for (const sliceId of ownerSlices) {
      const bucket = frozenCoveredBySlice.get(sliceId) ?? [];
      bucket.push(criterionId);
      frozenCoveredBySlice.set(sliceId, bucket);
    }
  }

  const seams: ReconnectSeam[] = [];
  for (const slice of slices) {
    for (const dependency of slice.depends_on) {
      if (!sliceIds.has(dependency)) {
        seams.push({
          slice_id: slice.slice_id,
          depends_on: dependency,
          kind: 'dangling',
          detail: `${slice.slice_id} depends on ${dependency}, which is absent from the assembly.`,
        });
        continue;
      }
      const upstreamCriteria = frozenCoveredBySlice.get(dependency) ?? [];
      const unprovenUpstream = upstreamCriteria.filter(
        (criterionId) => !provenSet.has(criterionId),
      );
      if (unprovenUpstream.length > 0) {
        seams.push({
          slice_id: slice.slice_id,
          depends_on: dependency,
          kind: 'upstream-unproven',
          detail: `${slice.slice_id} is wired onto ${dependency}, whose criteria are not all proven (${unprovenUpstream.join(', ')}).`,
        });
      }
    }
  }
  return seams;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}
