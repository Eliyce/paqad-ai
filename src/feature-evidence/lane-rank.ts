import { LANES, type Lane } from '@/core/types/routing.js';

import type { FeatureLane } from './types.js';

export function laneRank(lane: FeatureLane): number {
  return lane === null ? -1 : LANES.indexOf(lane as Lane);
}

export function higherLane(current: FeatureLane, incoming: FeatureLane): FeatureLane {
  return laneRank(incoming) > laneRank(current) ? incoming : current;
}
