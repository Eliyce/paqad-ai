// RAG-evidence recorder (issue #249 P1). Script-only — the LLM never hand-authors a
// row; the seams (background worker, prompt hook) call these verbs. Every write is
// envelope-stamped + AJV-validated by the shared substrate, and best-effort: a recorder
// failure must never break the prompt path, so errors are swallowed (returns null).

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { redactSecrets } from '@/rag/secrets.js';

import { validateRagEvidenceRow } from './schema.js';
import { resolveSessionId } from './session.js';
import {
  RAG_EVIDENCE_DOC_TYPE,
  RAG_EVIDENCE_SCHEMA_VERSION,
  type RagEvidenceKind,
  type RagEvidenceRow,
} from './types.js';

/** Fields a caller supplies for a record (envelope fields are stamped automatically). */
export type RagEvidenceFields = Partial<
  Omit<
    RagEvidenceRow,
    | 'schema_version'
    | 'doc_type'
    | 'kind'
    | 'session_id'
    | 'conversation_ordinal'
    | 'ts'
    | 'content_hash'
  >
>;

export interface RagEvidenceContext {
  /** Host session id (e.g. Claude hook stdin); resolved/minted when absent. */
  sessionId?: string | null;
  /** Conversation ordinal to attach to; resolved from the `.open` pointer when absent. */
  ordinal?: number;
  /** The master-switch state at event time. */
  ragEnabled: boolean;
  /** Provider adapter (claude-code, codex-cli, …). */
  adapter: string;
  /** Clock seam for tests. */
  now?: () => Date;
}

const APPEND_OPTS = (now?: () => Date) => ({
  schemaVersion: RAG_EVIDENCE_SCHEMA_VERSION,
  validate: (row: SessionLedgerRow) => validateRagEvidenceRow(row),
  now,
});

/**
 * Open a new conversation (prompt turn) for the session and return its ordinal. Called
 * by the prompt seam once per prompt. Returns null on any failure (best-effort).
 */
export function openRagConversation(
  projectRoot: string,
  ctx: RagEvidenceContext,
): { sessionId: string; ordinal: number } | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    const { ordinal } = openSessionDoc(
      projectRoot,
      RAG_EVIDENCE_DOC_TYPE,
      sessionId,
      { rag_enabled: ctx.ragEnabled, adapter: ctx.adapter },
      APPEND_OPTS(ctx.now),
    );
    return { sessionId, ordinal };
  } catch {
    return null;
  }
}

/**
 * Record one RAG-evidence event. Resolves the session + conversation ordinal (opening a
 * conversation if none exists yet, so background-worker events always land on a real
 * unit), redacts any `note`, validates, and appends. Returns the stamped row or null.
 */
export function recordRagEvidence(
  projectRoot: string,
  kind: RagEvidenceKind,
  fields: RagEvidenceFields,
  ctx: RagEvidenceContext,
): RagEvidenceRow | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    const ordinal = resolveOrdinal(projectRoot, sessionId, ctx);
    const note =
      typeof fields.note === 'string'
        ? redactSecrets(fields.note, projectRoot)
        : (fields.note ?? null);
    const row: Record<string, unknown> = {
      kind,
      conversation_ordinal: ordinal,
      rag_enabled: ctx.ragEnabled,
      adapter: ctx.adapter,
      ...fields,
      note,
    };
    return appendSessionEvent(
      projectRoot,
      RAG_EVIDENCE_DOC_TYPE,
      sessionId,
      ordinal,
      row,
      APPEND_OPTS(ctx.now),
    ) as unknown as RagEvidenceRow;
  } catch {
    // Best-effort: evidence recording must never break the runtime path.
    return null;
  }
}

/** Use the supplied ordinal, else the current open one, else open a fresh conversation. */
function resolveOrdinal(projectRoot: string, sessionId: string, ctx: RagEvidenceContext): number {
  if (ctx.ordinal && ctx.ordinal > 0) {
    return ctx.ordinal;
  }
  const current = currentOrdinal(projectRoot, RAG_EVIDENCE_DOC_TYPE, sessionId);
  if (current > 0) {
    return current;
  }
  const { ordinal } = openSessionDoc(
    projectRoot,
    RAG_EVIDENCE_DOC_TYPE,
    sessionId,
    { rag_enabled: ctx.ragEnabled, adapter: ctx.adapter },
    APPEND_OPTS(ctx.now),
  );
  return ordinal;
}
