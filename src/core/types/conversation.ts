// ── PQD-171: deterministic per-turn API-conversation rebuild ─────────────────
//
// The desktop persists a *display* conversation — the full message list including
// stopped, edited/discarded, and branched messages. Before each turn the engine
// must reshape that into a clean *API* conversation: active branch only, within
// the model's context window, with retrieved chunks inserted at the budgeted
// position. These types describe the display/API message shapes and the result;
// the logic lives in `src/context/conversation-rebuild.ts`.

/**
 * A persisted conversation message as the desktop stores it. A superset of the
 * minimal wire shape: the extra fields let the engine compute lineage (which
 * branch is active) and exclude stopped/discarded turns.
 *
 * `branchId`/`parentMessageId`/`discardedAt` are all optional so a flat history
 * (no branching, the current desktop shape) is a valid `DisplayMessage[]`.
 *
 * @since 1.10.0
 */
export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** ISO-8601 creation timestamp; the sole chronological ordering key. */
  createdAt: string;
  /** A turn the user stopped mid-stream; excluded from the rebuild. */
  stopped?: boolean;
  /** ISO-8601 instant the turn was discarded by an edit; `null`/absent ⇒ live. */
  discardedAt?: string | null;
  /** Branch this message belongs to; `null`/absent ⇒ the main branch. */
  branchId?: string | null;
  /** Parent message id for lineage walking; `null`/absent ⇒ a root turn. */
  parentMessageId?: string | null;
}

/**
 * The clean wire shape handed to the LLM API: role and content only, plus an
 * optional `name` for tool/function attribution. Everything the model does not
 * need (ids, timestamps, branch metadata) is dropped.
 *
 * @since 1.10.0
 */
export interface ApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

/**
 * Where a retrieved chunk was inserted into the rebuilt conversation, for a
 * context inspector to render. `position` is the index of the inserted message
 * in the returned `ApiMessage[]`.
 *
 * @since 1.10.0
 */
export interface RetrievedChunkRef {
  chunkId: string;
  position: number;
}

/**
 * The deterministic output of a rebuild. `messages` is the API conversation for
 * the next turn; `retrievedChunkIds` lists every chunk folded in (empty when no
 * retrieval ran); `truncated`/`truncatedTurnCount` report whether oldest turns
 * were dropped after summarisation could not fit history into the window.
 *
 * @since 1.10.0
 */
export interface ConversationRebuildResult {
  messages: ApiMessage[];
  retrievedChunkIds: string[];
  truncated: boolean;
  truncatedTurnCount: number;
  /**
   * Issue #123 — SHA-256 over the canonical, versioned materials this rebuild
   * froze (lineage, classifier output, retrieved chunk digests, budget,
   * summariser mode, truncation). Proves the context is replayable from these
   * inputs; it does NOT assert bit-identical LLM regeneration. See
   * `computeContextHash`.
   *
   * @since 1.19.0
   */
  contextHash: string;
}

/**
 * SHA-256 hex digest of the serialised rebuild inputs (display conversation plus
 * classifier output). Used as the {@link DisplayMessage} cache key so an
 * unchanged turn is served without re-running the classifier or budget passes.
 *
 * @since 1.10.0
 */
export type RebuildCacheKey = string;

/**
 * Structured failure thrown by `rebuildApiConversation` when the budget breakdown
 * is malformed (e.g. a non-positive window) or the summariser/optimizer throws.
 * The rebuild never auto-retries; it surfaces this so the desktop's catch block
 * can map it to a pending-error banner. The `kind` discriminant lets a consumer
 * route on it without an `instanceof` import.
 *
 * @since 1.10.0
 */
export class RebuildFailedError extends Error {
  readonly kind = 'rebuild_failed' as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`Conversation rebuild failed: ${reason}`);
    this.name = 'RebuildFailedError';
    this.reason = reason;
  }
}
