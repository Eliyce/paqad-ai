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
  adapter?: string;
  now?: () => Date;
}

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
    return null;
  }
}

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
