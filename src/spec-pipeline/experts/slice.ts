import type { AgentRole } from '@/core/types/agent.js';

import { expertBudget } from './roster.js';
import type { ExpertSlice } from './types.js';

export interface ExpertSlicePlan {
  slices: ExpertSlice[];
  warnings: string[];
}

export function ceilingWarning(sum: number, ceiling: number, count: number): string {
  return (
    `expert slices need ${sum} tokens but the run ceiling is ${ceiling}; scaled ${count} ` +
    `expert${count === 1 ? '' : 's'} to fit — none dropped`
  );
}

export function planExpertSlices(roles: readonly AgentRole[], ceiling: number): ExpertSlicePlan {
  if (roles.length === 0) {
    return { slices: [], warnings: [] };
  }

  const budgets = roles.map((role) => ({ role, budget: expertBudget(role) }));
  const sum = budgets.reduce((total, entry) => total + entry.budget, 0);

  if (sum <= ceiling) {
    return {
      slices: budgets.map(({ role, budget }) => ({
        role,
        budget,
        granted: budget,
        clamped: false,
      })),
      warnings: [],
    };
  }

  const slices: ExpertSlice[] = budgets.map(({ role, budget }) => {
    const granted = Math.max(1, Math.floor((budget / sum) * ceiling));
    return { role, budget, granted, clamped: granted < budget };
  });
  return { slices, warnings: [ceilingWarning(sum, ceiling, roles.length)] };
}
