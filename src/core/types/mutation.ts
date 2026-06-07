// Mutation-testing types. Issue #105 — "make sure the tests would actually
// catch a mistake."
//
// A mutation run plants small behaviour-changing mistakes (mutants) in the
// *changed* code, runs the existing tests against each, and reports the kill
// rate plus the survivors that point at weak checking. The bar is: every
// mutant that could change behaviour must be killed; equivalent mutants
// (semantically identical changes that cannot be killed) are set aside and do
// not count against the bar.
//
// This file owns the data shapes only. The per-language tool selection lives
// in `src/mutation/adapter.ts`, the changed-file scoping in `scope.ts`, the
// kill-rate maths in `outcome.ts`, and the orchestration in `runner.ts`.

// How much to trust a mutation result. Mature per-language tools (Stryker for
// JS/TS, PIT for the JVM, …) produce `mature` results; languages with weak or
// abandoned tooling produce a `lower` result so nobody over-trusts the score.
export const MUTATION_CONFIDENCE_LEVELS = ['mature', 'lower'] as const;
export type MutationConfidence = (typeof MUTATION_CONFIDENCE_LEVELS)[number];

// The shape of the gate outcome derived from a run.
export const MUTATION_GATE_STATUSES = [
  // Every behaviour-changing mutant was killed (or there were none to plant).
  'killed-all',
  // At least one behaviour-changing mutant survived → weak checking.
  'survivors',
  // The run completed but the tooling is weak for this language; the result is
  // present but lower-confidence regardless of survivors.
  'lower-confidence',
  // The run did not happen (fast lane, no changed code, tool not configured, or
  // tests were not green to begin with).
  'skipped',
  // Safety violation: the working tree was not clean after the run. Mutants may
  // have been left behind — this is a hard failure.
  'unsafe-tree',
] as const;
export type MutationGateStatus = (typeof MUTATION_GATE_STATUSES)[number];

export const MUTATION_SKIP_REASONS = [
  'fast-lane',
  'no-changed-code',
  'tool-not-configured',
  'tests-not-green',
  'run-failed',
] as const;
export type MutationSkipReason = (typeof MUTATION_SKIP_REASONS)[number];

// The status of a single planted mutant as normalised from a tool report.
export const MUTANT_STATUSES = [
  'killed', // a test failed → the mutant was caught
  'timeout', // the suite hung on the mutant → counted as caught
  'survived', // every test still passed → behaviour change went unnoticed
  'no-coverage', // no test exercised the mutated code → also a survivor
  'equivalent', // cannot change behaviour → set aside, excluded from the bar
  'error', // tool/compile error mutating this site → excluded from the bar
] as const;
export type MutantStatus = (typeof MUTANT_STATUSES)[number];

// A single normalised mutant emitted by a per-language tool adapter.
export interface RawMutant {
  file: string;
  line: number;
  // The mutation operator that produced this mutant (e.g. `ConditionalExpression`,
  // `ArithmeticOperator`). Tool-specific name, surfaced verbatim.
  operator: string;
  status: MutantStatus;
  // Optional human-readable original→mutated description for the finding.
  description?: string;
}

// A survivor surfaced as a precise pointer to weak checking (file/line/operator).
export interface SurvivingMutant {
  file: string;
  line: number;
  operator: string;
  description?: string;
}

// The per-language tool the adapter selected for a stack.
export interface MutationToolDescriptor {
  // Stable tool id, e.g. `stryker`, `pit`, `mutmut`, `infection`.
  tool: string;
  // Languages this tool covers, lower-cased.
  languages: string[];
  // How much to trust this tool's output for the resolved language.
  confidence: MutationConfidence;
  // The command the runner invokes (the runner appends scope arguments).
  run_command: string;
  // Files/markers that indicate the tool is configured in the onboarded project.
  config_markers: string[];
}

// The full result of a mutation run, written through verification evidence.
export interface MutationResult {
  // The tool used, or null when the run was skipped before tool selection.
  tool: string | null;
  // The resolved language label, or null when unknown.
  language: string | null;
  confidence: MutationConfidence;
  // The changed files the run was scoped to (only changed code is mutated).
  scoped_files: string[];
  // Counts. `killed` includes timeouts; `survived` includes no-coverage.
  total_mutants: number;
  killed: number;
  survived: number;
  // Equivalent + errored mutants are excluded from the bar and the denominator.
  equivalent_set_aside: number;
  // killed / (killed + survived). Null when there were no eligible mutants.
  kill_rate: number | null;
  surviving_mutants: SurvivingMutant[];
  // Safety: the working tree was verified clean after planting/removal.
  tree_clean: boolean;
  status: MutationGateStatus;
  skipped_reason: MutationSkipReason | null;
}
