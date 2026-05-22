import type { ClassificationWorkflow, ContextBudgetHint } from '@/core/types/classification.js';
import type { ClassificationScope } from '@/core/types/classification.js';

export interface ContextBudgetEstimateInput {
  scope: ClassificationScope;
  delta_candidate: boolean;
  workflow: ClassificationWorkflow | null;
}

export function estimateContextBudgetHint(input: ContextBudgetEstimateInput): ContextBudgetHint {
  if (
    input.scope === 'system-wide' ||
    input.workflow === 'migration' ||
    input.workflow === 'architecture-change'
  ) {
    return 'deep';
  }

  if (input.delta_candidate || input.scope === 'multi-module') {
    return 'standard';
  }

  return 'minimal';
}
