import {
  readChangeCost,
  type ChangeCostRecord,
  type CostScope,
  type CostExpertLine,
  type CostLine,
  type CostStageLine,
  type CostTokens,
  type CostWindow,
} from '@/cost/change-cost.js';

export interface HudCost {
  computed_at: string;
  window: CostWindow;
  scope: CostScope;
  price_table_date: string;
  price_source: string;
  basis: string;
  label: string;
  plan_note: string;
  tokens: CostTokens;
  usd: number | null;
  unpriced_models: string[];
  by_stage: CostStageLine[];
  by_expert: CostExpertLine[];
  chief: (CostLine & { exact: boolean }) | null;
  not_counted: string[];
}

export function hudCostOf(record: ChangeCostRecord): HudCost {
  return {
    computed_at: record.computed_at,
    window: record.window,
    scope: record.scope ?? 'whole-session',
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

export function buildHudCost(projectRoot: string, dirName: string): HudCost | null {
  const record = readChangeCost(projectRoot, dirName);
  return record ? hudCostOf(record) : null;
}
