// Issue #117 — the agent-independent verification backstop: build a context
// from repository reality, compute the judgment gate inputs, run the existing
// gates, and emit one trust verdict. Consumed by the generated completion hook
// and the git/CI backstop.

export {
  buildRepositoryVerificationContext,
  type BuildRepositoryVerificationContextOptions,
  type RepositoryVerificationContextResult,
} from './repository-context.js';
export {
  computeAcTestMapping,
  computeImplementationReview,
  computeSpecReview,
  type JudgmentSignal,
} from './judgment-inputs.js';
export { collectScopeDriftPaths } from './scope-drift.js';
export {
  runRepositoryVerification,
  backstopGates,
  type RunRepositoryVerificationOptions,
} from './run-repository-verification.js';
export {
  buildRepositoryVerificationVerdict,
  formatVerdictSummary,
  type RepositoryVerificationVerdict,
  type RepositoryVerificationGateVerdict,
} from './verdict.js';
