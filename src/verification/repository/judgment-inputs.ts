// Issue #117 (C-2) — compute the judgment gate inputs from repository reality
// instead of stubbing them to `true`. Each function here is pure over its
// already-loaded artifact (traceability map, pending decision packets, spec
// review report) so the determination is deterministic and unit-testable. The
// context builder (`repository-context.ts`) loads the artifacts from disk and
// feeds them in.
//
// The contract the issue sets: never pass vacuously. A signal that can be
// computed is computed; a signal that genuinely needs model judgment (or whose
// proving artifact is absent when promises exist) returns `inconclusive` so the
// gate escalates rather than waving the change through.

import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { ImplementationReviewFinding } from '@/core/types/verification.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import type { SpecReviewReport } from '@/compliance/types.js';

/**
 * A computed judgment signal. `inconclusive` is distinct from `passed: false`:
 * it means "this could not be proven either way and must escalate", never
 * "assume fine".
 */
export interface JudgmentSignal {
  passed: boolean;
  inconclusive: boolean;
  detail: string;
}

/** The four honest readings of the `ac-test-mapping` gate (issue #639, Part 11). */
export type AcTestMappingOutcome = 'pass' | 'fail' | 'not-required' | 'did-not-run';

export interface AcTestMappingSignal extends JudgmentSignal {
  outcome: AcTestMappingOutcome;
}

export interface AcTestMappingInput {
  /** True when the active change has a frozen spec. */
  specFrozen: boolean;
  /** The change-scoped map (`buildChangeTraceabilityMap`), or null when it was not built. */
  map: TraceabilityMap | null;
  /** Visual criterion ids, left to the visual-evidence gate. */
  visual?: readonly string[];
  /** Manual criterion ids, which need no mapped test. */
  manual?: readonly string[];
  /** Why the map could not be built, when it could not. */
  buildError?: string | null;
}

/**
 * `ac-test-mapping` from the change-scoped traceability map (issue #639, Part 11). The map
 * carries the frozen spec's AUTOMATED criteria and the changed test files that prove them.
 *
 * - No frozen spec → not required: there are no acceptance criteria to map.
 * - A frozen spec but no map → did not run: the map is missing, so nothing was checked.
 * - A map with no automated criteria → not required: only visual or manual criteria exist.
 * - Any automated criterion with no proving test → fail, naming every one.
 * - Every automated criterion proved → pass, with the count.
 *
 * Not required and did not run keep `passed: true` so the change-completeness roll-up does
 * not block on them; the gate records them as skipped, never as a pass.
 */
export function computeAcTestMapping(input: AcTestMappingInput): AcTestMappingSignal {
  if (!input.specFrozen) {
    return {
      outcome: 'not-required',
      passed: true,
      inconclusive: false,
      detail: 'No frozen spec, so no acceptance criteria to map.',
    };
  }

  if (input.map === null) {
    const why = input.buildError ? ` (${input.buildError})` : '';
    return {
      outcome: 'did-not-run',
      passed: true,
      inconclusive: false,
      detail: `A frozen spec is on record but the acceptance-criteria map is missing${why}, so no criterion was checked.`,
    };
  }

  const acLinks = input.map.forward.filter((link) => link.source === 'acceptance-criterion');
  if (acLinks.length === 0) {
    return {
      outcome: 'not-required',
      passed: true,
      inconclusive: false,
      detail: describeNoAutomatedCriteria(input.visual ?? [], input.manual ?? []),
    };
  }

  const unproven = acLinks.filter((link) => !link.proven).map((link) => link.promise_id);
  if (unproven.length > 0) {
    return {
      outcome: 'fail',
      passed: false,
      inconclusive: false,
      detail: `Automated acceptance criteria with no proving test changed on this branch: ${unproven.join(', ')}.`,
    };
  }

  return {
    outcome: 'pass',
    passed: true,
    inconclusive: false,
    detail: `All ${acLinks.length} automated acceptance criteria map to a proving test.`,
  };
}

function describeNoAutomatedCriteria(visual: readonly string[], manual: readonly string[]): string {
  if (visual.length === 0 && manual.length === 0) {
    return 'The frozen spec has no automated acceptance criteria to map.';
  }
  const named = [
    visual.length > 0 ? `visual: ${visual.join(', ')}` : '',
    manual.length > 0 ? `manual: ${manual.join(', ')}` : '',
  ]
    .filter((part) => part.length > 0)
    .join('; ');
  return (
    `The frozen spec has only visual or manual acceptance criteria (${named}). Visual ones ` +
    'are left to the visual-evidence gate and manual ones need no mapped test.'
  );
}

/**
 * `implementation-review` from the decision store. A change that lands while a
 * decision packet is still unresolved violated the decision-pause contract: the
 * agent should have paused. Each unresolved pending packet becomes a blocking
 * `decision-violation` finding (issue #117 C-2/C-3).
 */
export function computeImplementationReview(pendingDecisions: DecisionPacket[]): {
  passed: boolean;
  findings: ImplementationReviewFinding[];
} {
  const findings: ImplementationReviewFinding[] = pendingDecisions.map((packet) => ({
    kind: 'decision-violation',
    severity: 'error',
    detail: `Change landed against unresolved decision ${packet.decision_id} (${packet.category}): ${packet.question}`,
    decision_id: packet.decision_id,
  }));

  return { passed: findings.length === 0, findings };
}

/**
 * `spec-review` from the spec-review report
 * (`.paqad/spec-review/<slug>.json`, loaded by the compliance spec-review
 * store) plus the frozen-spec presence signal.
 *
 * - Report present with an unresolved critical defect → fail (the spec is not
 *   clean enough to freeze).
 * - Report present, clean → pass.
 * - No report but a frozen spec exists → pass (the spec was signed off).
 * - No report and no frozen spec, yet the change touches code → pass but
 *   `inconclusive` (escalate, do not block): "was the spec frozen and reviewed?"
 *   genuinely needs human/model judgment, so the verdict flags it rather than
 *   either silently asserting pass or blocking every spec-less change.
 * - No report, no frozen spec, no code change → pass (a docs-only/chore change).
 *
 * Note: `inconclusive` is reported with `passed: true` so the backstop does not
 * block a clean change that simply predates a frozen spec; the trust verdict
 * surfaces the inconclusive signal so it is never *silently* passed.
 */
export function computeSpecReview(input: {
  specReview: SpecReviewReport | null;
  hasFrozenSpec: boolean;
  codeChanged: boolean;
}): JudgmentSignal {
  if (input.specReview) {
    const openCritical = input.specReview.defects.filter(
      (defect) => defect.severity === 'critical' && defect.status !== 'resolved',
    );
    if (openCritical.length > 0) {
      return {
        passed: false,
        inconclusive: false,
        detail: `Unresolved critical spec-review defects: ${openCritical
          .map((defect) => defect.defect_id)
          .join(', ')}.`,
      };
    }
    return {
      passed: true,
      inconclusive: false,
      detail: 'Spec review on record carries no unresolved critical defects.',
    };
  }

  if (input.hasFrozenSpec) {
    return {
      passed: true,
      inconclusive: false,
      detail: 'Spec is frozen (signed off); no open spec-review report.',
    };
  }

  if (input.codeChanged) {
    return {
      passed: true,
      inconclusive: true,
      detail:
        'Code changed but no frozen spec or spec-review report was found; whether the spec was frozen and reviewed cannot be proven.',
    };
  }

  return {
    passed: true,
    inconclusive: false,
    detail: 'No code change requiring a spec review.',
  };
}
