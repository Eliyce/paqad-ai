export const PLANNING_MANIFEST_VERSION = 1 as const;

export const PLAN_MODES = {
  FULL: 'full',
  DELTA: 'delta',
} as const;

export const PLANNING_LANES = {
  FAST: 'fast',
  GRADUATED: 'graduated',
  FULL: 'full',
} as const;

export const REQUIREMENT_TYPES = {
  FUNCTIONAL: 'functional',
  NON_FUNCTIONAL: 'non-functional',
  CONSTRAINT: 'constraint',
  EDGE_CASE: 'edge-case',
} as const;

export const PROOF_TYPES = {
  AUTOMATED: 'automated',
  MANUAL: 'manual',
  VISUAL: 'visual',
} as const;

export const CRITERION_STATUSES = {
  UNCOVERED: 'uncovered',
  COVERED: 'covered',
  PARTIAL: 'partial',
  INDETERMINATE: 'indeterminate',
} as const;

export const HEALTH_TIERS = {
  STABLE: 'stable',
  MODERATE: 'moderate',
  FRAGILE: 'fragile',
  UNKNOWN: 'unknown',
} as const;

export const ROLLBACK_CLASSES = {
  SAFE: 'safe',
  NEEDS_MIGRATION: 'needs-migration',
  DESTRUCTIVE: 'destructive',
} as const;
