// Site-map progress ledger types (issue #448). The site-map publisher's own
// differential-refresh record, persisted to `.paqad/site-map/progress.json`. It is a
// deliberate fork of the documentation workflow's DocProgress ledger: the two concerns are
// independent, and coupling site-map publication to `doc-progress.json` meant a legacy or
// invalid doc-progress could abort a site-map run. Site-map now owns this shape end to end.

/** Bumped when the persisted shape changes; the store rejects a mismatched file. */
export const SITE_MAP_PROGRESS_SCHEMA_VERSION = 1;

/** Lifecycle of a single published view; mirrors the doc-progress states the publisher used. */
export type SiteMapProgressState = 'not_started' | 'generating' | 'done' | 'failed';

/**
 * One published site-map view (index.md, overview.md, a registry, …) and the staleness signal
 * used to decide whether it must be re-written. `source_hash` is a hash of `source_files`
 * captured at publish time; a fresh hash that differs means the view drifted from the code.
 */
export interface SiteMapProgressEntry {
  /** Repo-relative, forward-slash path of the generated view. */
  path: string;
  state: SiteMapProgressState;
  started_at: string | null;
  completed_at: string | null;
  /** Repo-relative source files whose hash gates a refresh. */
  source_files: string[];
  /** Hash of `source_files` at the last publish, or null before the first one. */
  source_hash: string | null;
  /** Rough token estimate of the written view, or null before the first publish. */
  tokens_used: number | null;
}

/** The persisted `.paqad/site-map/progress.json` document. */
export interface SiteMapProgressFile {
  schema_version: typeof SITE_MAP_PROGRESS_SCHEMA_VERSION;
  generated_by: 'paqad-ai';
  /** Published views keyed by their repo-relative path. */
  views: Record<string, SiteMapProgressEntry>;
}
