export const DECISION_REUSE_DOC_TYPE = 'paqad.decision-reuse';

export const DECISION_REUSE_SCHEMA_VERSION = 1;

export type DecisionReuseKind = 'open' | 'reuse';

export type DecisionReuseMatch = 'exact' | 'fingerprint';

export interface DecisionReuseRow {
  schema_version: number;
  doc_type: typeof DECISION_REUSE_DOC_TYPE;
  kind: DecisionReuseKind;
  session_id: string;
  conversation_ordinal: number;
  ts: string;
  adapter: string;

  decision_id?: string | null;
  category?: string | null;
  chosen_option_key?: string | null;
  match_kind?: DecisionReuseMatch | null;
  source_path?: string | null;
  note?: string | null;
  content_hash: string;
}
