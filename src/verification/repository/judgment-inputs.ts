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

/**
 * `ac-test-mapping` from the traceability map (`.paqad/traceability/map.json`).
 * The map is the source of truth for which acceptance criteria exist and
 * whether each links to a proving check.
 *
 * - Map present, AC promises all proven → pass.
 * - Map present, one or more AC promises unproven → fail, naming the AC ids.
 * - Map present, no AC promises → pass (nothing to map — honest, not vacuous).
 * - Map absent → pass with a "no acceptance criteria on record" detail. The map
 *   carries the ACs; with no map there is nothing to prove, so a clean change in
 *   a project that never froze a spec is not blocked.
 */
export function computeAcTestMapping(map: TraceabilityMap | null): JudgmentSignal {
  if (map === null) {
    return {
      passed: true,
      inconclusive: false,
      detail: 'No traceability map on record; no acceptance criteria to map.',
    };
  }

  const acLinks = map.forward.filter((link) => link.source === 'acceptance-criterion');
  if (acLinks.length === 0) {
    return {
      passed: true,
      inconclusive: false,
      detail: 'Traceability map carries no acceptance criteria to map.',
    };
  }

  const unproven = acLinks.filter((link) => !link.proven).map((link) => link.promise_id);
  if (unproven.length > 0) {
    return {
      passed: false,
      inconclusive: false,
      detail: `Acceptance criteria with no proving check: ${unproven.join(', ')}.`,
    };
  }

  return {
    passed: true,
    inconclusive: false,
    detail: `All ${acLinks.length} acceptance criteria map to a proving check.`,
  };
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
