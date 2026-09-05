// Per-expert context slice sizing (issue #521, FR-5 / FR-8.3 / AC-3 / INV-4 / INV-5).
//
// Each needed expert gets a bounded slice, sized from its canonical role budget
// (`ROLE_TOKEN_BUDGETS`, via `expertBudget`) — never the whole project. When the summed budgets
// fit under the run's token ceiling every expert gets its full budget. When they DON'T fit, the
// discipline is "warn, never drop" (issue #521 §4.6): every needed expert is kept and their
// slices are scaled to fit the ceiling, with a recorded warning — the framework never silently
// drops an expert the detector said was needed. Deterministic; zero model tokens.

import type { AgentRole } from '@/core/types/agent.js';

import { expertBudget } from './roster.js';
import type { ExpertSlice } from './types.js';

export interface ExpertSlicePlan {
  slices: ExpertSlice[];
  /** Non-blocking warnings (a ceiling breach is one) — surfaced, never a dropped expert. */
  warnings: string[];
}

/** The warning recorded when the summed slices exceed the run ceiling (AC-6). */
export function ceilingWarning(sum: number, ceiling: number, count: number): string {
  return (
    `expert slices need ${sum} tokens but the run ceiling is ${ceiling}; scaled ${count} ` +
    `expert${count === 1 ? '' : 's'} to fit — none dropped (issue #521 §4.6)`
  );
}

/**
 * Plan the context slices for the needed experts. `ceiling` is the run's per-run token ceiling
 * (`spec_pipeline_token_ceiling`). Returns one {@link ExpertSlice} per role — every role kept —
 * plus any warnings. An empty roster yields an empty plan and no warning.
 */
export function planExpertSlices(roles: readonly AgentRole[], ceiling: number): ExpertSlicePlan {
  if (roles.length === 0) {
    return { slices: [], warnings: [] };
  }

  const budgets = roles.map((role) => ({ role, budget: expertBudget(role) }));
  const sum = budgets.reduce((total, entry) => total + entry.budget, 0);

  // Under the ceiling: everyone gets their full budget, nothing clamped.
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

  // Over the ceiling: keep every expert (INV-5), scale each slice proportionally to fit. A tiny
  // ceiling still grants at least 1 token per kept expert so no slice collapses to nothing.
  const slices: ExpertSlice[] = budgets.map(({ role, budget }) => {
    const granted = Math.max(1, Math.floor((budget / sum) * ceiling));
    return { role, budget, granted, clamped: granted < budget };
  });
  return { slices, warnings: [ceilingWarning(sum, ceiling, roles.length)] };
}
