// Analytics-tag ledger types (issue #241).
//
// A script-written, per-(session, conversation) record of the analytics tracking tags the
// complementary analytics-instrumentation agent wrote into a build — when a tag was ADDED,
// on which build, to which file, for which provider. The honest guarantee mirrors the
// stage- and rag-evidence ledgers: this proves a recorder script observed a tag write at a
// wall-clock time, never that the tracking is correct or that the event ever fired.
//
// Recording is gated on the `analytics_instrumentation` flag (owner decision): when the
// agent is off it writes no tags, so there is nothing to record; when on, every tag it
// writes lands a row automatically. Both recording and reading are script-driven — the LLM
// never hand-authors or hand-reads a row.

/** Doc type stamped on every row and used as the ledger sub-directory. */
export const ANALYTICS_TAG_DOC_TYPE = 'paqad.analytics-tag';

/** Schema version for `paqad.analytics-tag` rows. */
export const ANALYTICS_TAG_SCHEMA_VERSION = 1;

/** `open` starts a conversation unit; `tag_added` records one tag write. */
export type AnalyticsTagKind = 'open' | 'tag_added';

/** One `paqad.analytics-tag` row (envelope fields are stamped by the substrate). */
export interface AnalyticsTagRow {
  schema_version: number;
  doc_type: typeof ANALYTICS_TAG_DOC_TYPE;
  kind: AnalyticsTagKind;
  session_id: string;
  conversation_ordinal: number;
  ts: string;
  /** Which host wrote it (claude-code, codex-cli, gemini-cli, engine, …). */
  adapter: string;

  // kind:tag_added
  /** The event/tag name written (e.g. `checkout_completed`). */
  tag_name?: string | null;
  /** The analytics destination (ga4, segment, posthog, mixpanel, amplitude, …). */
  tag_provider?: string | null;
  /** The file the tag was written into, repo-relative. */
  source_path?: string | null;

  /** Optional free text, excluded from the identity hash. */
  note?: string | null;
  content_hash: string;
}

/** One tag's rolled-up view for the tracking map (issue #241 §8). */
export interface AnalyticsTagFoldEntry {
  tag_name: string;
  tag_provider: string | null;
  source_path: string | null;
  /** How many times this (tag, provider, path) was recorded across the session. */
  occurrences: number;
  /** ISO ts of the most recent record for this tag. */
  last_seen: string;
}

/** The per-session rollup `analytics-tag show` computes (issue #241 §8). */
export interface AnalyticsTagSessionFold {
  session_id: string;
  /** Distinct tags, ordered by name for determinism. */
  tags: AnalyticsTagFoldEntry[];
  totals: {
    /** Total `tag_added` rows across the session. */
    tag_added_count: number;
    /** Distinct tag names. */
    distinct_tags: number;
    /** Distinct providers seen. */
    providers: string[];
  };
}
