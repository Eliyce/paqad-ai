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
  sessionId?: string | null;
  ordinal?: number;
  ragEnabled: boolean;
  adapter: string;
  now?: () => Date;
}

const APPEND_OPTS = (now?: () => Date) => ({
  schemaVersion: RAG_EVIDENCE_SCHEMA_VERSION,
  validate: (row: SessionLedgerRow) => validateRagEvidenceRow(row),
  now,
});

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
    const stamped = stampSessionRow(RAG_EVIDENCE_DOC_TYPE, sessionId, row, APPEND_OPTS(ctx.now));
    mirrorRagRow(projectRoot, sessionId, stamped);
    return stamped as unknown as RagEvidenceRow;
  } catch {
    return null;
  }
}

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
