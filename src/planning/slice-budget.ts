import type { ExecutionSlice, SliceBudgetSummary } from '@/core/types/planning.js';

export interface SliceBudgetPlan {
  total: number;
  perSlice: Record<string, number>;
  summary: SliceBudgetSummary;
  warnings: string[];
}

const DEFAULT_TOTAL_BUDGET = 15000;
const BUFFER_MULTIPLIER = 1.3;

export function computeSliceBudgetPlan(
  slices: ExecutionSlice[],
  totalBudget = DEFAULT_TOTAL_BUDGET,
  consumed = 0,
): SliceBudgetPlan {
  const sliceCount = Math.max(slices.length, 1);
  const manualOverrides = slices.filter((slice) => typeof slice.token_budget === 'number');
  const overrideTotal = manualOverrides.reduce((sum, slice) => sum + slice.token_budget!, 0);
  const nonOverridden = slices.filter((slice) => slice.token_budget === undefined);
  const remainingBudget = totalBudget - overrideTotal;
  const weightedTotal = nonOverridden.reduce((sum, slice) => sum + sliceWeight(slice), 0);
  const distributableBudget = Math.max(0, remainingBudget);
  const perSlice: Record<string, number> = {};

  for (const slice of slices) {
    if (typeof slice.token_budget === 'number') {
      perSlice[slice.slice_id] = slice.token_budget;
      continue;
    }

    perSlice[slice.slice_id] = Math.round(
      (distributableBudget * sliceWeight(slice) * BUFFER_MULTIPLIER) / weightedTotal,
    );
  }

  const warnings =
    overrideTotal > totalBudget
      ? [
          `Slice token_budget overrides exceed the total task budget (${overrideTotal} > ${totalBudget}).`,
        ]
      : [];

  return {
    total: totalBudget,
    perSlice,
    summary: {
      total: totalBudget,
      per_slice_base: Math.round(totalBudget / sliceCount),
      per_slice_with_buffer: Math.round((totalBudget / sliceCount) * BUFFER_MULTIPLIER),
      consumed,
      remaining: Math.max(0, totalBudget - consumed),
    },
    warnings,
  };
}

export function resolveSliceExecutionBudget(input: {
  slice: ExecutionSlice;
  slices: ExecutionSlice[];
  remainingBudget: number;
  currentStatuses: Record<string, { status?: string }>;
}): number {
  if (typeof input.slice.token_budget === 'number') {
    return input.slice.token_budget;
  }

  const remainingCandidates = input.slices.filter((slice) => {
    if (typeof slice.token_budget === 'number') {
      return false;
    }
    const status = input.currentStatuses[slice.slice_id]?.status;
    return status !== 'completed';
  });
  const totalWeight = remainingCandidates.reduce((sum, slice) => sum + sliceWeight(slice), 0);
  if (totalWeight === 0) {
    return 0;
  }

  return Math.round(
    (Math.max(0, input.remainingBudget) * sliceWeight(input.slice) * BUFFER_MULTIPLIER) /
      totalWeight,
  );
}

function sliceWeight(slice: ExecutionSlice): number {
  if (slice.rollback_class === 'destructive') {
    return 1.5;
  }
  if (slice.rollback_class === 'needs-migration') {
    return 1.2;
  }
  return 1;
}
