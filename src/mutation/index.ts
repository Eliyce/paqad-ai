// Mutation testing on changed code. Issue #105.
export { selectMutationTool, mutationConfidenceFor } from './adapter.js';
export { scopeMutationTargets } from './scope.js';
export { computeMutationOutcome, type MutationOutcomeInput } from './outcome.js';
export {
  runMutationGate,
  buildCommand,
  type MutationRunnerDeps,
  type RunMutationGateOptions,
  type MutationCommandResult,
} from './runner.js';
