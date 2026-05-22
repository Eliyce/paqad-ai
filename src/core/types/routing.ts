import type { ActiveCapability, Domain } from './domain.js';
import type { DetectedStackProfile } from './introspection.js';

export const LANES = ['fast', 'graduated', 'full'] as const;
export type Lane = (typeof LANES)[number];

export const PROCESS_DEPTHS = ['fast lane', 'graduated lane', 'full lane'] as const;
export type ProcessDepth = (typeof PROCESS_DEPTHS)[number];

export const COMPLEXITY_LEVELS = ['trivial', 'low', 'medium', 'high', 'very-high'] as const;
export type Complexity = (typeof COMPLEXITY_LEVELS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISK_LEVELS)[number];

export interface RoutingConfig {
  domain?: Domain;
  active_capabilities?: ActiveCapability[];
  matched_packs?: string[];
  stack_profile?: DetectedStackProfile;
  stack?: string;
  capabilities?: string[];
}

export function selectLane(complexity: Complexity, risk: Risk): Lane {
  if (complexity === 'trivial') {
    return 'fast';
  }

  if (complexity === 'low' && risk === 'low') {
    return 'fast';
  }

  if (complexity === 'low' && risk !== 'low') {
    return 'graduated';
  }

  if (complexity === 'medium' && risk !== 'high') {
    return 'graduated';
  }

  return 'full';
}
