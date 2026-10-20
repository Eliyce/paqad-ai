import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { ImplementationReviewFinding, WaitingDecision } from '@/core/types/verification.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import type { SpecReviewReport } from '@/compliance/types.js';

export interface JudgmentSignal {
  passed: boolean;
  inconclusive: boolean;
  detail: string;
}

export type AcTestMappingOutcome = 'pass' | 'fail' | 'not-required' | 'did-not-run';

export interface AcTestMappingSignal extends JudgmentSignal {
  outcome: AcTestMappingOutcome;
}

export interface AcTestMappingInput {
  specFrozen: boolean;
  map: TraceabilityMap | null;
  visual?: readonly string[];
  manual?: readonly string[];
  buildError?: string | null;
}

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

export function computeImplementationReview(
  pendingDecisions: DecisionPacket[],
  lastSourceEditAt: string | null = null,
): {
  passed: boolean;
  findings: ImplementationReviewFinding[];
  waiting: WaitingDecision[];
} {
  const editedAt = lastSourceEditAt === null ? NaN : Date.parse(lastSourceEditAt);
  const blocking = pendingDecisions.filter((packet) => !openedAfter(packet, editedAt));
  const findings: ImplementationReviewFinding[] = blocking.map((packet) => ({
    kind: 'decision-violation',
    severity: 'error',
    detail: `Change landed against unresolved decision ${packet.decision_id} (${packet.category}): ${packet.question}`,
    decision_id: packet.decision_id,
  }));
  const waiting: WaitingDecision[] = pendingDecisions
    .filter((packet) => openedAfter(packet, editedAt))
    .map((packet) => ({
      decision_id: packet.decision_id,
      category: packet.category,
      question: packet.question,
    }));

  return { passed: findings.length === 0, findings, waiting };
}

function openedAfter(packet: DecisionPacket, editedAt: number): boolean {
  if (Number.isNaN(editedAt)) return false;
  const createdAt = Date.parse(packet.created_at);
  return !Number.isNaN(createdAt) && createdAt > editedAt;
}

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
