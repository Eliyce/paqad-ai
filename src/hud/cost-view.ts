import {
  computeChangeCost,
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
  live: boolean;
}

export function hudCostOf(record: ChangeCostRecord, live = false): HudCost {
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
    live,
  };
}

export interface BuildHudCostOptions {
  turnRunning?: boolean;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

function countFromCache(
  projectRoot: string,
  dirName: string,
  options: BuildHudCostOptions,
): ChangeCostRecord | null {
  try {
    const counted = computeChangeCost(projectRoot, dirName, { now: options.now });
    return counted && counted.sources > 0 && counted.tokens.total > 0 ? counted : null;
  } catch (error) {
    options.onError?.(error);
    return null;
  }
}

export function buildHudCost(
  projectRoot: string,
  dirName: string,
  options: BuildHudCostOptions = {},
): HudCost | null {
  const running = options.turnRunning === true;
  const record = readChangeCost(projectRoot, dirName);
  if (record) return hudCostOf(record, running && !record.window.sealed);
  if (!running) return null;
  const counted = countFromCache(projectRoot, dirName, options);
  return counted ? hudCostOf(counted, true) : null;
}
