// Analytics-tag recorder (issue #241). Script-only — the LLM never hand-authors a row; the
// seams (Claude PreToolUse writer, the completion marker parser) call these verbs. Every
// write is envelope-stamped + AJV-validated by the shared substrate, and best-effort: a
// tag-add is a hot path on the edit, so a recorder failure must never break it (returns
// null). Contrast with stage-evidence's recorder, which throws — wrong policy here.
//
// Recording is gated on the analytics flag (owner decision): a caller passes
// `analyticsEnabled`, resolved from `analytics_instrumentation`. When it is false the
// recorder is a silent no-op — OFF writes no row, in every branch.

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { redactSecrets } from '@/rag/secrets.js';

import { validateAnalyticsTagRow } from './schema.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import {
  ANALYTICS_TAG_DOC_TYPE,
  ANALYTICS_TAG_SCHEMA_VERSION,
  type AnalyticsTagRow,
} from './types.js';

/** The tag-specific fields a caller supplies (envelope + kind are stamped automatically). */
export interface AnalyticsTagFields {
  tagName: string;
  tagProvider?: string | null;
  sourcePath?: string | null;
  note?: string | null;
}

export interface AnalyticsTagContext {
  /** Host session id (Claude hook stdin); resolved/minted when absent. */
  sessionId?: string | null;
  /** Conversation ordinal to attach to; resolved from the `.open` pointer when absent. */
  ordinal?: number;
  /** Provider adapter (claude-code, codex-cli, gemini-cli, engine, …). */
  adapter?: string;
  /**
   * The `analytics_instrumentation` flag state at event time. Recording is gated on this:
   * when false, the recorder is a silent no-op. Defaults to false (OFF is the safe default).
   */
  analyticsEnabled?: boolean;
  /** Clock seam for tests. */
  now?: () => Date;
}

const APPEND_OPTS = (now?: () => Date) => ({
  schemaVersion: ANALYTICS_TAG_SCHEMA_VERSION,
  validate: (row: SessionLedgerRow) => validateAnalyticsTagRow(row),
  now,
});

/**
 * Open a new conversation unit for the session and return its ordinal. Returns null on any
 * failure (best-effort) or when analytics is disabled.
 */
export function openAnalyticsTagConversation(
  projectRoot: string,
  ctx: AnalyticsTagContext = {},
): { sessionId: string; ordinal: number } | null {
  if (!ctx.analyticsEnabled) {
    return null;
  }
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    const { ordinal } = openSessionDoc(
      projectRoot,
      ANALYTICS_TAG_DOC_TYPE,
      sessionId,
      { adapter: ctx.adapter ?? 'unknown' },
      APPEND_OPTS(ctx.now),
    );
    return { sessionId, ordinal };
  } catch {
    return null;
  }
}

/**
 * Record one analytics-tag write. Resolves the session + conversation ordinal (opening a
 * unit if none exists yet), redacts any `note`, validates, and appends a `tag_added` row.
 * Returns the stamped row, or null when analytics is disabled or on any failure.
 */
export function recordAnalyticsTag(
  projectRoot: string,
  fields: AnalyticsTagFields,
  ctx: AnalyticsTagContext = {},
): AnalyticsTagRow | null {
  if (!ctx.analyticsEnabled) {
    // OFF is silent: no row, in every branch.
    return null;
  }
  try {
    const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
    const adapter = ctx.adapter ?? 'unknown';
    const ordinal = resolveOrdinal(projectRoot, sessionId, adapter, ctx);
    const note =
      typeof fields.note === 'string'
        ? redactSecrets(fields.note, projectRoot)
        : (fields.note ?? null);
    return appendSessionEvent(
      projectRoot,
      ANALYTICS_TAG_DOC_TYPE,
      sessionId,
      ordinal,
      {
        kind: 'tag_added',
        conversation_ordinal: ordinal,
        adapter,
        tag_name: fields.tagName,
        tag_provider: fields.tagProvider ?? null,
        source_path: fields.sourcePath ?? null,
        note,
      },
      APPEND_OPTS(ctx.now),
    ) as unknown as AnalyticsTagRow;
  } catch {
    // Best-effort: tag recording must never break the edit path.
    return null;
  }
}

/** Use the supplied ordinal, else the current open one, else open a fresh conversation. */
function resolveOrdinal(
  projectRoot: string,
  sessionId: string,
  adapter: string,
  ctx: AnalyticsTagContext,
): number {
  if (ctx.ordinal && ctx.ordinal > 0) {
    return ctx.ordinal;
  }
  const current = currentOrdinal(projectRoot, ANALYTICS_TAG_DOC_TYPE, sessionId);
  if (current > 0) {
    return current;
  }
  return openSessionDoc(
    projectRoot,
    ANALYTICS_TAG_DOC_TYPE,
    sessionId,
    { adapter },
    APPEND_OPTS(ctx.now),
  ).ordinal;
}
