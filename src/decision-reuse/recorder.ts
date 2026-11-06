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
  type DecisionReuseKind,
  type DecisionReuseMatch,
  type DecisionReuseOutcome,
  type DecisionReuseRow,
} from './types.js';

const APPEND_OPTS = (now?: () => Date) => ({
  schemaVersion: DECISION_REUSE_SCHEMA_VERSION,
  validate: (row: SessionLedgerRow) => validateDecisionReuseRow(row),
  now,
});

export interface DecisionReuseFields {
  decisionId: string | null;
  kind?: DecisionReuseKind;
  category?: string | null;
  chosenOptionKey?: string | null;
  matchKind?: DecisionReuseMatch | null;
  sourcePath?: string | null;
  note?: string | null;
  outcome?: DecisionReuseOutcome;
  change?: string | null;
  forDecision?: string | null;
  ruleId?: string | null;
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
    const sessionId = resolveSessionId(
      projectRoot,
      ctx.sessionId ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
    );
    const adapter = ctx.adapter ?? 'unknown';
    const ordinal = ensureUnit(projectRoot, sessionId, adapter, ctx.now);
    return appendSessionEvent(
      projectRoot,
      DECISION_REUSE_DOC_TYPE,
      sessionId,
      ordinal,
      {
        kind: fields.kind ?? 'reuse',
        conversation_ordinal: ordinal,
        adapter,
        decision_id: fields.decisionId,
        category: fields.category ?? null,
        chosen_option_key: fields.chosenOptionKey ?? null,
        match_kind: fields.matchKind ?? null,
        source_path: fields.sourcePath ?? null,
        note: fields.note ?? null,
        ...(fields.outcome ? { outcome: fields.outcome } : {}),
        ...(fields.change ? { change: fields.change } : {}),
        ...(fields.forDecision ? { for_decision: fields.forDecision } : {}),
        ...(fields.ruleId ? { rule_id: fields.ruleId } : {}),
      },
      APPEND_OPTS(ctx.now),
    ) as unknown as DecisionReuseRow;
  } catch {
    return null;
  }
}

export interface SuggestionOutcomeInput {
  forDecision: string;
  category?: string | null;
  chosen: string;
  change?: string | null;
  suggestion?: { earlier_id: string; option_key: string; reason: string };
}

export function recordSuggestionOutcome(
  projectRoot: string,
  input: SuggestionOutcomeInput,
  ctx: DecisionReuseContext = {},
): DecisionReuseRow | null {
  if (input.suggestion === undefined) return null;
  return recordDecisionReuse(
    projectRoot,
    {
      kind: 'suggestion',
      decisionId: input.suggestion.earlier_id,
      matchKind: 'intent',
      category: input.category,
      chosenOptionKey: input.chosen,
      note: input.suggestion.reason,
      outcome: input.chosen === input.suggestion.option_key ? 'accepted' : 'changed',
      change: input.change,
      forDecision: input.forDecision,
    },
    ctx,
  );
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
