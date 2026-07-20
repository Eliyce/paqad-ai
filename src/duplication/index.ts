// Public surface of the duplication detector (issue #358).

export { detectNewCodeDuplication, type DetectOptions } from './detect.js';
export { runDuplicationScan, type ScanOptions } from './scan.js';
export {
  resolveDuplicationConfig,
  resolveDuplicationMode,
  DEFAULT_DUPLICATION_MODE,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_MIN_LINES,
  HEURISTIC_BAND_FLOOR,
  DUPLICATION_MODES,
  type DuplicationConfig,
  type DuplicationMode,
} from './config.js';
export {
  buildDuplicationReport,
  readDuplicationReport,
  writeDuplicationReport,
  recordDuplicationRun,
  summarizeFindings,
  DUPLICATION_REPORT_SCHEMA_VERSION,
  DUPLICATION_EVIDENCE_DOC_TYPE,
  type DuplicationReport,
} from './report.js';
export {
  applyResolvedDecisions,
  buildDuplicationDecisionContext,
  findingKey,
  DUPLICATION_DECISION_CATEGORY,
  type ResolvedDuplicationDecision,
} from './decisions.js';
export { duplicationMessage, formatRange, type DuplicationFinding } from './types.js';
export { type LineRange } from './hunks.js';
