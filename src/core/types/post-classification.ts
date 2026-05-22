import type { Complexity, Risk } from './routing.js';

export interface PostClassificationAdjustments {
  complexity: Complexity;
  risk: Risk;
  lane_before_override: string;
  lane_override_reason: string | null;
  risk_floor: Risk | null;
  risk_floor_reason: string | null;
  complexity_adjustment: number;
  complexity_adjustment_reason: string | null;
  resolution_updates: Record<string, string>;
  high_override_rate: boolean;
}
