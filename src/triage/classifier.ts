import type { Lane } from '@/core/types/routing.js';
import type { TriageFinding, TriageVerdict } from '@/core/types/triage.js';

export function classifyFinding(finding: TriageFinding): TriageVerdict {
  const s = finding.signals;
  const base = { finding_id: finding.id, ambiguous: false } as const;

  if (s.refuted_by_evidence) {
    return {
      ...base,
      pile: 'false-alarm',
      route: 'record',
      reason: 'Contradicted by evidence — set aside as a misread.',
    };
  }

  if (s.measurable_quality) {
    return {
      ...base,
      pile: null,
      route: 'ratchet',
      reason: 'Measurable quality regression — handed to the quality ratchet.',
    };
  }

  if (s.spec_silent) {
    return {
      ...base,
      pile: 'unclear-spec',
      route: 'spec',
      reason: 'The spec did not cover this — routed to the spec, not patched.',
    };
  }

  if (s.gate_failed) {
    if (s.out_of_scope) {
      return {
        ...base,
        pile: 'confirmed',
        confirmation: s.reproducible ? 'demonstrable' : 'needs-repro',
        route: 'tech-debt',
        reason:
          'Confirmed, but outside this change. Record it with `paqad-ai debt add` instead of fixing it here.',
      };
    }
    if (s.reproducible) {
      return {
        ...base,
        pile: 'confirmed',
        confirmation: 'demonstrable',
        route: 'code-change',
        reason:
          'Failing gate with reproducing evidence — confirmed; proceed via the prove-it protocol.',
      };
    }
    return {
      ...base,
      pile: 'confirmed',
      confirmation: 'needs-repro',
      route: 'await-repro',
      reason:
        'Failing gate without a reproducing proof yet — confirmed-pending-repro; waits, does not drive a change.',
    };
  }

  if (s.style_only && !s.behavioural) {
    return {
      ...base,
      pile: 'taste',
      route: 'record',
      reason: 'Style-only with no behavioural effect — a matter of taste, recorded not acted on.',
    };
  }

  return {
    ...base,
    pile: null,
    ambiguous: true,
    route: 'ask-human',
    reason: 'No decisive signal — ambiguous; open a finding.triage Decision Pause.',
  };
}

export function triageFinding(finding: TriageFinding, lane: Lane): TriageVerdict {
  const verdict = classifyFinding(finding);
  if (verdict.route === 'ask-human' && lane === 'fast') {
    return {
      finding_id: finding.id,
      pile: null,
      ambiguous: false,
      route: 'record',
      reason: 'fast lane: ambiguous finding set aside automatically without a prompt.',
    };
  }
  return verdict;
}

export function canDriveCodeChange(verdict: TriageVerdict): boolean {
  return (
    verdict.pile === 'confirmed' &&
    verdict.confirmation === 'demonstrable' &&
    verdict.route === 'code-change'
  );
}

export function changeDrivingVerdicts(verdicts: TriageVerdict[]): TriageVerdict[] {
  return verdicts.filter(canDriveCodeChange);
}
