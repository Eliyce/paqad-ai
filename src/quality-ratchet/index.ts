// Quality ratchet — issue #110. Records the four quality measures at the
// project's real level and only ever allows equal-or-better.
export {
  qualityBaselinePath,
  sampleKey,
  createBaseline,
  tightenBaseline,
  applyApprovedRegressions,
  readQualityBaseline,
  writeQualityBaseline,
} from './baseline.js';
export {
  collectQualityMeasures,
  type CollectQualityMeasuresOptions,
  type FileDeficiency,
  type MeasureRunOptions,
  type MeasureRunResult,
  type QualityCollectorDeps,
} from './collector.js';
export { evaluateRatchet, exceptionKind, type EvaluateRatchetOptions } from './ratchet.js';
export {
  measureStrictness,
  measureStrictnessFromOptions,
  parseTsconfig,
  type StrictnessMeasure,
} from './strictness.js';
export {
  buildRatchetExceptionPacket,
  resolveReusableExceptionKinds,
  RATCHET_EXCEPTION_APPROVE,
  RATCHET_EXCEPTION_REFUSE,
  type RatchetExceptionInput,
} from './exception-decision.js';
export { runQualityRatchetGate, type RunQualityRatchetOptions } from './runner.js';
