// Decision-reuse ledger types (complements #247 / #249).
//
// A script-written, session-scoped record of every time the framework REUSES an
// already-approved decision from `.paqad/decisions/resolved/` instead of asking the
// user again (the priors-first auto-resolution). One session can reuse many
// decisions, so all reuses for a session append to a single unit. Built on the same
// shared session-ledger substrate as the rag-evidence (#249) and stage-evidence
// (#247) ledgers — git-ignored under `.paqad/ledger/`, always-on, enterprise-
// independent. The honest guarantee: this proves a recorder script observed a reuse
// of a named prior decision at a wall-clock time — never that the reuse was correct.

/** Doc type stamped on every row and used as the ledger sub-directory. */
export const DECISION_REUSE_DOC_TYPE = 'paqad.decision-reuse';

/** Schema version for `paqad.decision-reuse` rows. */
export const DECISION_REUSE_SCHEMA_VERSION = 1;

export type DecisionReuseKind = 'open' | 'reuse';

/** How the prior was matched: an exact fingerprint hit, or a fuzzy option overlap. */
export type DecisionReuseMatch = 'exact' | 'fingerprint';

/** One `paqad.decision-reuse` row (envelope fields are stamped by the substrate). */
export interface DecisionReuseRow {
  schema_version: number;
  doc_type: typeof DECISION_REUSE_DOC_TYPE;
  kind: DecisionReuseKind;
  session_id: string;
  conversation_ordinal: number;
  ts: string;
  adapter: string;

  /** The id of the prior resolved decision that was reused. */
  decision_id?: string | null;
  /** The decision category (component-reuse, architecture-path, intake.*, …). */
  category?: string | null;
  /** The chosen option key carried over from the prior. */
  chosen_option_key?: string | null;
  match_kind?: DecisionReuseMatch | null;
  /** Project-relative path of the reused resolved-decision file. */
  source_path?: string | null;
  note?: string | null;
  content_hash: string;
}
