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
