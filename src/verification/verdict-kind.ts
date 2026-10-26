import { gateOwner, recordGapText } from '@/core/types/verification.js';

export type VerdictKind = 'pass' | 'fail' | 'inconclusive';

export interface GateStatusLike {
  status: string;
}

export function verdictKindFor(
  gates: readonly GateStatusLike[],
  unrecordedMandatoryStages: readonly string[] = [],
): VerdictKind {
  if (gates.some((gate) => gate.status === 'fail')) return 'fail';
  if (gates.some((gate) => gate.status === 'inconclusive')) return 'inconclusive';
  if (unrecordedMandatoryStages.length > 0) return 'inconclusive';
  return 'pass';
}

export interface OwnedGateLike extends GateStatusLike {
  gate: string;
  detail: string;
}

export interface RecordGap {
  code: string;
  text: string;
  detail: string | null;
}

export interface VerdictParts {
  work_kind: VerdictKind;
  work_reasons: string[];
  record_gaps: RecordGap[];
}

export const LANE_RECORD_GAP: RecordGap = {
  code: 'lane',
  text: 'paqad could not record the lane for this change',
  detail: null,
};

const UNPROVEN_STATUSES: ReadonlySet<string> = new Set(['fail', 'inconclusive']);

const STAGE_WORDS: Readonly<Record<string, string>> = {
  ticket_intake: 'Intake',
  planning: 'Plan',
  specification: 'Spec',
  development: 'Build',
  review: 'Review',
  checks: 'Checks',
  documentation_sync: 'Docs',
  delivery: 'Deliver',
};

// States the fact and names the stages: a stage with no record yet may simply not have been
// reached, so the words blame nobody. "paqad could not record" stays for real record faults.
export function unrecordedStagesGap(stages: readonly string[]): RecordGap {
  return {
    code: 'unrecorded-mandatory-stages',
    text: `No record yet for: ${stages.map((stage) => STAGE_WORDS[stage] ?? stage).join(', ')}`,
    detail: null,
  };
}

export function verdictParts(
  gates: readonly OwnedGateLike[],
  unrecordedMandatoryStages: readonly string[] = [],
): VerdictParts {
  const work = gates.filter((gate) => gateOwner(gate.gate) === 'work');
  const workReasons = work
    .filter((gate) => UNPROVEN_STATUSES.has(gate.status))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1))
    .map((gate) => `${gate.gate}: ${gate.detail}`);
  const gaps: RecordGap[] = gates
    .filter((gate) => gateOwner(gate.gate) === 'paqad-record')
    .filter((gate) => UNPROVEN_STATUSES.has(gate.status))
    .map((gate) => ({ code: gate.gate, text: recordGapText(gate.gate), detail: gate.detail }));
  if (unrecordedMandatoryStages.length > 0) {
    gaps.push(unrecordedStagesGap(unrecordedMandatoryStages));
  }
  return { work_kind: verdictKindFor(work), work_reasons: workReasons, record_gaps: gaps };
}
