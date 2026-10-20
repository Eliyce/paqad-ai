export type {
  PreflightOption,
  PreflightQuestion,
  PreflightRequirement,
  PreflightRequirementResult,
  PreflightResult,
  ProbeOutcome,
  RequirementKind,
} from './contract.js';
export { requirementsFor } from './registry.js';
export { evaluateRequirements, runPreflight } from './run.js';
