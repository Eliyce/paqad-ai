// RAG-evidence recorder (issue #249 P1). Script-only — the LLM never hand-authors a
// row; the seams (background worker, prompt hook) call these verbs. Every write is
// envelope-stamped + AJV-validated by the shared substrate, and best-effort: a recorder
// failure must never break the prompt path, so errors are swallowed (returns null).

import { stampSessionRow, type SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  allocateChatOrdinal,
  currentChatOrdinal,
  mirrorRagRow,
} from '@/feature-evidence/bundle-ledgers.js';
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
 *
 * Issue #468 Phase C — the ordinal is allocated in the session's `_chat` home and the
 * `open` row is written to its two-home `rag.jsonl` (the active feature's bundle, else
 * `_chat`), replacing the retired `paqad.rag-evidence/<session>` substrate.
 */
export function openRagConversation(
  projectRoot: string,
  ctx: RagEvidenceContext,
): { sessionId: string; ordinal: number } | null {
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    const ordinal = openChatConversation(projectRoot, sessionId, ctx);
    return { sessionId, ordinal };
  } catch {
    return null;
  }
}

/**
 * Allocate a fresh `_chat` conversation ordinal and write its `open` row to the two-home
 * `rag.jsonl` (issue #468 Phase C). Shared by {@link openRagConversation} (the prompt seam)
 * and the auto-open path in {@link recordRagEvidence} (a background event with no open
 * conversation), so both produce the same `open`-then-data record the substrate used to.
 */
function openChatConversation(
  projectRoot: string,
  sessionId: string,
  ctx: RagEvidenceContext,
): number {
  const ordinal = allocateChatOrdinal(projectRoot, sessionId);
  const openRow = stampSessionRow(
    RAG_EVIDENCE_DOC_TYPE,
    sessionId,
    {
      kind: 'open',
      conversation_ordinal: ordinal,
      rag_enabled: ctx.ragEnabled,
      adapter: ctx.adapter,
    },
    APPEND_OPTS(ctx.now),
  );
  mirrorRagRow(projectRoot, sessionId, openRow);
  return ordinal;
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
    // Issue #468 Phase C — stamp the row (envelope + AJV validation, unchanged) and write
    // it ONLY to its two-home destination (the active feature's `rag.jsonl` or `_chat`).
    // The retired session substrate is no longer written; the fold reads the two homes.
    const stamped = stampSessionRow(RAG_EVIDENCE_DOC_TYPE, sessionId, row, APPEND_OPTS(ctx.now));
    mirrorRagRow(projectRoot, sessionId, stamped);
    return stamped as unknown as RagEvidenceRow;
  } catch {
    // Best-effort: evidence recording must never break the runtime path.
    return null;
  }
}

/**
 * Use the supplied ordinal, else the current open `_chat` ordinal, else open a fresh
 * conversation (issue #468 Phase C — the ordinal home moved to `_chat`). The fresh path
 * writes an `open` row so a background event with no open conversation records the same
 * `open`-then-data pair the retired substrate produced.
 */
function resolveOrdinal(projectRoot: string, sessionId: string, ctx: RagEvidenceContext): number {
  if (ctx.ordinal && ctx.ordinal > 0) {
    return ctx.ordinal;
  }
  const current = currentChatOrdinal(projectRoot, sessionId);
  if (current > 0) {
    return current;
  }
  return openChatConversation(projectRoot, sessionId, ctx);
}
