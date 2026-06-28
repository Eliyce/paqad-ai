// Decision-reuse recorder. Script-only and best-effort — recording a reuse must
// never break the decision flow, so any failure is swallowed (returns null). All
// reuses in a session append to a single unit (one session, many reuses).

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { validateDecisionReuseRow } from './schema.js';
import {
  DECISION_REUSE_DOC_TYPE,
  DECISION_REUSE_SCHEMA_VERSION,
  type DecisionReuseMatch,
  type DecisionReuseRow,
} from './types.js';

const APPEND_OPTS = (now?: () => Date) => ({
  schemaVersion: DECISION_REUSE_SCHEMA_VERSION,
  validate: (row: SessionLedgerRow) => validateDecisionReuseRow(row),
  now,
});

export interface DecisionReuseFields {
  decisionId: string;
  category?: string | null;
  chosenOptionKey?: string | null;
  matchKind: DecisionReuseMatch;
  sourcePath?: string | null;
  note?: string | null;
}

export interface DecisionReuseContext {
  sessionId?: string | null;
  /** Provider/source label; defaults to `unknown` when the caller has none. */
  adapter?: string;
  now?: () => Date;
}

/**
 * Record one reuse of an already-approved decision. Resolves the session, ensures a
 * single open unit for the session (opening it on the first reuse), and appends a
 * `kind:reuse` row. Returns the stamped row, or null on any failure.
 */
export function recordDecisionReuse(
  projectRoot: string,
  fields: DecisionReuseFields,
  ctx: DecisionReuseContext = {},
): DecisionReuseRow | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    const adapter = ctx.adapter ?? 'unknown';
    const ordinal = ensureUnit(projectRoot, sessionId, adapter, ctx.now);
    return appendSessionEvent(
      projectRoot,
      DECISION_REUSE_DOC_TYPE,
      sessionId,
      ordinal,
      {
        kind: 'reuse',
        conversation_ordinal: ordinal,
        adapter,
        decision_id: fields.decisionId,
        category: fields.category ?? null,
        chosen_option_key: fields.chosenOptionKey ?? null,
        match_kind: fields.matchKind,
        source_path: fields.sourcePath ?? null,
        note: fields.note ?? null,
      },
      APPEND_OPTS(ctx.now),
    ) as unknown as DecisionReuseRow;
  } catch {
    // Best-effort: never let reuse recording break the decision flow.
    return null;
  }
}

/** The session's single reuse unit, opening it on the first reuse. */
function ensureUnit(
  projectRoot: string,
  sessionId: string,
  adapter: string,
  now?: () => Date,
): number {
  const current = currentOrdinal(projectRoot, DECISION_REUSE_DOC_TYPE, sessionId);
  if (current > 0) {
    return current;
  }
  return openSessionDoc(
    projectRoot,
    DECISION_REUSE_DOC_TYPE,
    sessionId,
    { adapter },
    APPEND_OPTS(now),
  ).ordinal;
}
