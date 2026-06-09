// PQD-174 — types for session-scoped ephemeral attachment collections.
//
// These are the forward-looking contracts the desktop imports when it wires up
// its `attachments.*` IPC channels. They are purely additive: nothing in the
// existing RAG surface depends on them. The engine derives a collection's
// identity from the desktop's own `Session.id` and never mints a separate
// session identifier of its own.

/**
 * Identifier for a single session's ephemeral attachment collection. Branded so
 * a raw `sessionId` cannot be passed where a collection id is expected without
 * going through {@link toEphemeralCollectionId}. The value is the session id
 * itself — the collection is bound 1:1 to the session that owns it.
 */
export type EphemeralCollectionId = string & { readonly __brand: 'EphemeralCollectionId' };

/**
 * Brand a session id as its collection id. The collection is keyed directly by
 * the session id, so this is an identity cast that documents intent.
 */
export function toEphemeralCollectionId(sessionId: string): EphemeralCollectionId {
  return sessionId as EphemeralCollectionId;
}

/** Lifecycle state of a session's attachment collection. */
export type AttachmentRecordStatus = 'indexed' | 'stale' | 'in-progress';

/**
 * Persisted registry row mapping a session to its collection. The registry is
 * the source of truth the orphan sweep enumerates to find collections whose
 * owning session no longer exists.
 */
export interface AttachmentRecord {
  sessionId: string;
  collectionId: EphemeralCollectionId;
  filePaths: string[];
  status: AttachmentRecordStatus;
}

/** Successful completion shape returned by {@link SessionAttachmentIndexer.index}. */
export interface AttachmentIndexingResult {
  collectionId: EphemeralCollectionId;
  chunkCount: number;
  durationMs: number;
}

/**
 * Discriminated-union member returned (rather than thrown) when the embedding
 * provider stays unreachable through the initial attempt plus both retries. The
 * desktop reads `kind` to show a degraded-indexing warning while still allowing
 * the message to send without retrieval.
 */
export interface AttachmentIndexingDegradedSignal {
  kind: 'attachment_indexing_degraded';
  sessionId: string;
  reason: string;
  retriesExhausted: boolean;
}

/** The union an indexing call resolves to: success or a structured degrade. */
export type AttachmentIndexingOutcome = AttachmentIndexingResult | AttachmentIndexingDegradedSignal;

/** Narrowing guard for the degraded outcome. */
export function isAttachmentIndexingDegraded(
  outcome: AttachmentIndexingOutcome,
): outcome is AttachmentIndexingDegradedSignal {
  return (outcome as AttachmentIndexingDegradedSignal).kind === 'attachment_indexing_degraded';
}

/** One record per collection purged by the boot-time orphan sweep. */
export interface AttachmentOrphanPurgeRecord {
  collectionId: EphemeralCollectionId;
  purgedAt: string;
}
