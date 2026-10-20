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
