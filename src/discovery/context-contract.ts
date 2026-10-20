import { DISCOVERY_STAGE_ORDER, type DiscoveryStageId } from './stages.js';

export const CONTEXT_MODES = ['available', 'read', 'acknowledged'] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

export function isContextMode(value: string): value is ContextMode {
  return (CONTEXT_MODES as readonly string[]).includes(value);
}

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

export function stageContextContract(stage: string): readonly string[] {
  return (DISCOVERY_STAGE_CONTEXT as Record<string, readonly string[]>)[stage] ?? [];
}

export function extraContextItems(stage: string, loaded: readonly string[]): string[] {
  const bounded = new Set(stageContextContract(stage));
  return loaded.filter((item) => !bounded.has(item));
}

export function hasStageContract(stage: string): stage is DiscoveryStageId {
  return (DISCOVERY_STAGE_ORDER as readonly string[]).includes(stage);
}
