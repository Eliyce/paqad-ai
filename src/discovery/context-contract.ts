// Discovery stage-local context contract (issue #597, DW-11).
//
// A declarative per-stage table of the context a stage NORMALLY needs, so the owner session loads
// only that on stage entry instead of the whole rule library, every module doc, and the entire
// expert repository. The table BOUNDS the default load; it never forbids reading a material missing
// constraint — extra context is allowed with a recorded reason (see context-receipts.ts). The
// receipt is honest: it records what was made available/read/acknowledged, never a claim that the
// content was understood.

import { DISCOVERY_STAGE_ORDER, type DiscoveryStageId } from './stages.js';

/** How a receipt characterises a context item — never a claim of comprehension. */
export const CONTEXT_MODES = ['available', 'read', 'acknowledged'] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

export function isContextMode(value: string): value is ContextMode {
  return (CONTEXT_MODES as readonly string[]).includes(value);
}

/**
 * The bounded default context for each Discovery stage (DW-11 table). Values are stable context
 * KEYS the loader resolves, not file paths, so the contract stays host- and layout-neutral.
 */
export const DISCOVERY_STAGE_CONTEXT: Readonly<Record<DiscoveryStageId, readonly string[]>> = {
  understand: [
    'current-request',
    'prior-answers',
    'project-purpose',
    'module-summaries',
    'established-constraints',
  ],
  investigate: [
    'assigned-question',
    'module-source-pointers',
    'current-official-documentation',
    'selected-expert-instructions',
    'targeted-arch-security-operating-constraints',
  ],
  refine: [
    'current-brief',
    'contributions',
    'alternatives',
    'conflicts',
    'design-evaluation-rules',
  ],
  decide: [
    'the-choice',
    'evidence',
    'recommendation',
    'consequences',
    'decision-authority-records',
  ],
  check_readiness: [
    'current-requirements',
    'decisions',
    'scenarios',
    'unresolved-risks',
    'readiness-handoff-policy',
  ],
  hand_off: [
    'validated-outcome',
    'accepted-scope-constraints',
    'readiness-result',
    'destination-entry-contract',
  ],
} as const;

/** The bounded default context keys declared for a stage, or `[]` for an unknown stage. */
export function stageContextContract(stage: string): readonly string[] {
  return (DISCOVERY_STAGE_CONTEXT as Record<string, readonly string[]>)[stage] ?? [];
}

/**
 * The items in `loaded` that are NOT in the stage's bounded default set — the "extra" context that
 * DW-11 requires a recorded reason for. An unknown stage has an empty default, so everything is
 * extra (and thus needs a reason).
 */
export function extraContextItems(stage: string, loaded: readonly string[]): string[] {
  const bounded = new Set(stageContextContract(stage));
  return loaded.filter((item) => !bounded.has(item));
}

/** True when `stage` is one of the six Discovery stages the contract covers. */
export function hasStageContract(stage: string): stage is DiscoveryStageId {
  return (DISCOVERY_STAGE_ORDER as readonly string[]).includes(stage);
}
