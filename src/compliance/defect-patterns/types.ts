export const DEFECT_PATTERN_SCHEMA_VERSION = 1 as const;

/** Which integrity-system component produced the raw finding. */
export type DefectSource =
  'compliance' | 'audit' | 'heuristic' | 'test_quality' | 'boundary' | 'spec_review';

/** Stack context from the project profile at recording time. */
export interface StackContext {
  frameworks: string[];
  traits: string[];
}

/**
 * A single defect finding recorded from one integrity-system cycle.
 * Multiple findings of the same subcategory roll up into a DefectPatternEntry.
 */
export interface DefectFinding {
  defect_id: string;
  source: DefectSource;
  /** D1–D10 broad category from the integrity defect taxonomy. */
  category: string;
  /** Refined label: "{D-category}.{pattern}", e.g. "D5.missing-cli-surface". */
  subcategory: string;
  spec_file: string;
  obligation_id: string | null;
  stack_context: StackContext;
  description: string;
  file_path: string | null;
  recorded_at: string;
  resolved: boolean;
  recurrence_count: number;
}

/** Lightweight entry in the pattern index for fast lookups. */
export interface DefectPatternIndexEntry {
  pattern_id: string;
  subcategory: string;
  frequency: number;
  last_seen: string;
  stale: boolean;
}

/** Full aggregated pattern stored at entries/{id}.json. */
export interface DefectPatternEntry {
  pattern_id: string;
  subcategory: string;
  description: string;
  frequency: number;
  recency: string;
  stack_contexts: StackContext[];
  /** Up to 5 representative obligation descriptions. */
  example_obligations: string[];
  /** Up to 5 representative implementation file paths. */
  example_files: string[];
  severity_distribution: {
    critical: number;
    major: number;
    minor: number;
    info: number;
  };
  first_seen: string;
  last_seen: string;
  stale: boolean;
}

export interface DefectPatternIndex {
  schema_version: number;
  updated_at: string;
  entries: DefectPatternIndexEntry[];
}

/** Advisory surfaced in the spec quality review (FR-DP4). */
export interface PatternAdvisory {
  advisory_id: string;
  title: string;
  description: string;
}

/** Options for querying relevant patterns. */
export interface PatternQueryOptions {
  stack_context?: StackContext;
  /** Only return patterns with frequency >= this value (default 3 per FR-DP4.4). */
  min_frequency?: number;
  /** Only return patterns last seen within this many days (default 365). */
  max_age_days?: number;
  /** Maximum number of patterns to return (default 5 per FR-DP5.3). */
  limit?: number;
}
