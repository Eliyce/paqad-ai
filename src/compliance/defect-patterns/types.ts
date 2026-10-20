export const DEFECT_PATTERN_SCHEMA_VERSION = 1 as const;

export type DefectSource =
  'compliance' | 'audit' | 'heuristic' | 'test_quality' | 'boundary' | 'spec_review';

export interface StackContext {
  frameworks: string[];
  traits: string[];
}

export interface DefectFinding {
  defect_id: string;
  source: DefectSource;
  category: string;
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

export interface DefectPatternIndexEntry {
  pattern_id: string;
  subcategory: string;
  frequency: number;
  last_seen: string;
  stale: boolean;
}

export interface DefectPatternEntry {
  pattern_id: string;
  subcategory: string;
  description: string;
  frequency: number;
  recency: string;
  stack_contexts: StackContext[];
  example_obligations: string[];
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

export interface PatternAdvisory {
  advisory_id: string;
  title: string;
  description: string;
}

export interface PatternQueryOptions {
  stack_context?: StackContext;
  min_frequency?: number;
  max_age_days?: number;
  limit?: number;
}
