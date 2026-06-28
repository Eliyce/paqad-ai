// Decision-reuse ledger — public surface. Records every reuse of an already-
// approved decision from `.paqad/decisions/resolved/` into a git-ignored,
// session-scoped JSONL ledger under `.paqad/ledger/`, on the same substrate as the
// rag-evidence (#249) and stage-evidence (#247) ledgers.

export {
  DECISION_REUSE_DOC_TYPE,
  DECISION_REUSE_SCHEMA_VERSION,
  type DecisionReuseRow,
  type DecisionReuseKind,
  type DecisionReuseMatch,
} from './types.js';
export { validateDecisionReuseRow, DECISION_REUSE_SCHEMA } from './schema.js';
export {
  recordDecisionReuse,
  type DecisionReuseFields,
  type DecisionReuseContext,
} from './recorder.js';
