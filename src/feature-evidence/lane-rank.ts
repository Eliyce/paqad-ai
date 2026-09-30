// Lane ordering + the monotonic ratchet (issue #602).
//
// The lane that governs the stage-isolation safety check must only ever RISE across a
// change's lifetime (INV-1): a small follow-up turn that classifies correctly-as-small must
// never be able to relabel a large build "fast" and so switch the check off. This module is
// the ONE place lane ordering is defined — reused by the feature.json write path and the
// operator `lane set` command, so the two can never disagree (NFR-1, RULE-13 RL-3210).
//
// The order is the canonical `LANES` order (fast < graduated < full). A null lane is
// "unresolved" and ranks below every real lane, so it never overwrites a recorded one and a
// real lane always wins over it.

import { LANES, type Lane } from '@/core/types/routing.js';

import type { FeatureLane } from './types.js';

/**
 * The rank of a lane in the canonical fast < graduated < full order. An unresolved (null)
 * lane ranks -1, below every real lane, so it is always the lowest.
 */
export function laneRank(lane: FeatureLane): number {
  return lane === null ? -1 : LANES.indexOf(lane as Lane);
}

/**
 * The higher of two lanes (issue #602). `incoming` wins only when it ranks strictly above
 * `current`; otherwise `current` is kept. A null `incoming` never lowers a recorded lane, and
 * a real `incoming` always beats a null `current`. This is the ratchet: fed the current and a
 * proposed lane, it returns a lane that never decreases.
 */
export function higherLane(current: FeatureLane, incoming: FeatureLane): FeatureLane {
  return laneRank(incoming) > laneRank(current) ? incoming : current;
}
