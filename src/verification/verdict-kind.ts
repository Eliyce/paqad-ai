// The one verdict rule (issue #639, Part 4).
//
// Before this, one run could read three ways: the chat receipt said Inconclusive,
// `report.html` ignored inconclusive gates and said Safe to merge, and the PR comment
// folded inconclusive into `overall_status: 'fail'` and said Needs your attention. Every
// surface that prints a verdict word now asks this function, so they cannot disagree.

/** The three verdict kinds behind the contract words (Safe to merge / Needs your attention / Inconclusive). */
export type VerdictKind = 'pass' | 'fail' | 'inconclusive';

/** Anything carrying a gate status: an evidence gate, a verdict gate, or a bundle row. */
export interface GateStatusLike {
  status: string;
}

/**
 * The verdict for a set of gate statuses:
 * - any `fail` gate: `fail` (Needs your attention);
 * - otherwise any `inconclusive` gate: `inconclusive` (a gate that could not reach a confident
 *   result is never a pass);
 * - otherwise any unrecorded mandatory stage (issue #472): `inconclusive`;
 * - otherwise `pass`. Skipped gates never move the verdict.
 */
export function verdictKindFor(
  gates: readonly GateStatusLike[],
  unrecordedMandatoryStages: readonly string[] = [],
): VerdictKind {
  if (gates.some((gate) => gate.status === 'fail')) return 'fail';
  if (gates.some((gate) => gate.status === 'inconclusive')) return 'inconclusive';
  if (unrecordedMandatoryStages.length > 0) return 'inconclusive';
  return 'pass';
}
