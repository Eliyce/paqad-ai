export const MUTATION_CONFIDENCE_LEVELS = ['mature', 'lower'] as const;
export type MutationConfidence = (typeof MUTATION_CONFIDENCE_LEVELS)[number];

export const MUTATION_GATE_STATUSES = [
  'killed-all',
  'survivors',
  'lower-confidence',
  'skipped',
  'unsafe-tree',
] as const;
export type MutationGateStatus = (typeof MUTATION_GATE_STATUSES)[number];

export const MUTATION_SKIP_REASONS = [
  'fast-lane',
  'no-changed-code',
  'tool-not-configured',
  'tests-not-green',
  'run-failed',
  'no-test-command',
] as const;
export type MutationSkipReason = (typeof MUTATION_SKIP_REASONS)[number];

export const MUTANT_STATUSES = [
  'killed',
  'timeout',
  'survived',
  'no-coverage',
  'equivalent',
  'error',
] as const;
export type MutantStatus = (typeof MUTANT_STATUSES)[number];

export interface RawMutant {
  file: string;
  line: number;
  operator: string;
  status: MutantStatus;
  description?: string;
}

export interface SurvivingMutant {
  file: string;
  line: number;
  operator: string;
  description?: string;
}

export interface MutationToolDescriptor {
  tool: string;
  languages: string[];
  confidence: MutationConfidence;
  run_command: string;
  config_markers: string[];
}

export interface MutationResult {
  tool: string | null;
  language: string | null;
  confidence: MutationConfidence;
  scoped_files: string[];
  total_mutants: number;
  killed: number;
  survived: number;
  equivalent_set_aside: number;
  kill_rate: number | null;
  surviving_mutants: SurvivingMutant[];
  tree_clean: boolean;
  status: MutationGateStatus;
  skipped_reason: MutationSkipReason | null;
}
