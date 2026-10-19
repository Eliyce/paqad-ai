// The HUD snapshot's `cost` field (issue #639, Part 23).
//
// Read from the change's `cost.json` only, which the Stop and SubagentStop hooks write. The
// snapshot never reads a transcript itself, so building it stays cheap and a refresh from a verb
// can never disagree with what the hooks recorded. No file reads `null` ("not yet").

import {
  readChangeCost,
  type ChangeCostRecord,
  type CostExpertLine,
  type CostLine,
  type CostStageLine,
  type CostTokens,
  type CostWindow,
} from '@/cost/change-cost.js';

export interface HudCost {
  computed_at: string;
  window: CostWindow;
  price_table_date: string;
  price_source: string;
  basis: string;
  label: string;
  plan_note: string;
  tokens: CostTokens;
  /** The priced part in US dollars, an estimate; null when no token is priced. */
  usd: number | null;
  unpriced_models: string[];
  by_stage: CostStageLine[];
  by_expert: CostExpertLine[];
  chief: (CostLine & { exact: boolean }) | null;
  not_counted: string[];
}

/** The fields of a cost record the HUD shows, in a fixed order. */
export function hudCostOf(record: ChangeCostRecord): HudCost {
  return {
    computed_at: record.computed_at,
    window: record.window,
    price_table_date: record.price_table_date,
    price_source: record.price_source,
    basis: record.basis,
    label: record.label,
    plan_note: record.plan_note,
    tokens: record.tokens,
    usd: record.usd,
    unpriced_models: record.unpriced_models,
    by_stage: record.by_stage,
    by_expert: record.by_expert,
    chief: record.chief,
    not_counted: record.not_counted,
  };
}

/** The change's cost as the HUD shows it, or null when no `cost.json` was written yet. */
export function buildHudCost(projectRoot: string, dirName: string): HudCost | null {
  const record = readChangeCost(projectRoot, dirName);
  return record ? hudCostOf(record) : null;
}
