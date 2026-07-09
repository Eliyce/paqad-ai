// RAG-evidence ledger types (issue #249 P1).
//
// A script-written, per-(session, conversation) record of what the RAG layer actually
// did at runtime — when the index was REFRESHED, when retrieval was CALLED, when the
// precomputed context was USED (injected into a prompt), and when it FELL BACK to grep.
// The honest guarantee: this proves a recorder script ran for a named event at a
// wall-clock time with the counts it observed — never that the model benefited.

/** Doc type stamped on every row and used as the ledger sub-directory. */
export const RAG_EVIDENCE_DOC_TYPE = 'paqad.rag-evidence';

/** Schema version for `paqad.rag-evidence` rows. */
export const RAG_EVIDENCE_SCHEMA_VERSION = 1;

export type RagEvidenceKind = 'open' | 'refreshed' | 'called' | 'used' | 'fallback' | 'close';

export type RagRefreshKind =
  'rebuild' | 'incremental-sync' | 'rule-context' | 'vision' | 'crs' | 'attachment';

export type RagQueryScope = 'docs' | 'code' | 'all';

export type RagInjectedSection = 'rules' | 'memory' | 'retrieval' | 'drift';

export type RagFallbackReason =
  | 'rag-disabled'
  | 'no-index'
  | 'cold'
  | 'below-floor'
  | 'provider-mismatch'
  | 'chunker-mismatch'
  | 'error';

/** One `paqad.rag-evidence` row (envelope fields are stamped by the substrate). */
export interface RagEvidenceRow {
  schema_version: number;
  doc_type: typeof RAG_EVIDENCE_DOC_TYPE;
  kind: RagEvidenceKind;
  session_id: string;
  conversation_ordinal: number;
  ts: string;
  rag_enabled: boolean;
  adapter: string;

  // kind:refreshed
  refresh_kind?: RagRefreshKind | null;
  changed_files?: number | null;
  chunks_embedded?: number | null;
  chunks_cached?: number | null;

  // kind:called
  query_scope?: RagQueryScope | null;
  top_n?: number | null;
  candidates?: number | null;

  // kind:used
  injected?: boolean | null;
  injected_sections?: RagInjectedSection[] | null;
  slice_count?: number | null;
  pointer_count?: number | null;
  score_top?: number | null;
  bytes_injected?: number | null;

  // kind:fallback
  fallback_reason?: RagFallbackReason | null;

  // common context (best-effort, from real meta)
  chunker_version?: string | null;
  index_branch?: string | null;
  latency_ms?: number | null;
  note?: string | null;
  content_hash: string;
}

/** The per-session rollup `rag-evidence show` computes (issue #249 §4). */
export interface RagEvidenceConversationFold {
  conversation_ordinal: number;
  refresh_count: number;
  called_count: number;
  used_count: number;
  fallback_count: number;
  used_rate: number | null;
  avg_latency_ms: number | null;
  score_top: number | null;
  sections_used: RagInjectedSection[];
}

export interface RagEvidenceSessionFold {
  session_id: string;
  conversations: RagEvidenceConversationFold[];
  totals: {
    refresh_count: number;
    called_count: number;
    used_count: number;
    fallback_count: number;
  };
  coverage: {
    prompts_total: number;
    prompts_with_rag: number;
    prompts_fallback: number;
    fallback_reasons: Record<string, number>;
  };
}
