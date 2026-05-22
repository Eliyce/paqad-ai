import type { EscalationReason } from './token-efficiency.js';

export const TEST_OUTPUT_SCHEMA_VERSION = '1.0.0';
export const UNKNOWN_TEST_OUTPUT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export const TEST_ISSUE_CATEGORIES = ['assertion', 'error', 'timeout', 'unknown'] as const;
export type TestIssueCategory = (typeof TEST_ISSUE_CATEGORIES)[number];

export const TEST_PARSE_STRATEGIES = ['structured', 'plain-text-fallback', 'degraded'] as const;
export type TestParseStrategy = (typeof TEST_PARSE_STRATEGIES)[number];

export interface StructuredTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  duration_ms: number;
  timestamp: string;
  runner_id: string;
}

export interface StructuredTestIssue {
  test_id: string;
  suite: string | null;
  message: string;
  stack_trace: string | null;
  file_path: string | null;
  line_number: number | null;
  category: TestIssueCategory;
  duration_ms: number | null;
}

export interface StructuredTestWarning {
  type: string;
  message: string;
  source_test_id: string | null;
}

export interface StructuredTestParseMetadata {
  raw_byte_size: number;
  structured_byte_size: number;
  compression_ratio: number;
  original_size: number;
  compact_size: number;
  reduction_ratio: number;
  delta_mode_used: boolean;
  escalation_occurred: boolean;
  escalation_reason: EscalationReason | null;
  delta_summary: {
    newly_failing_tests: number;
    newly_passing_tests: number;
    newly_errored_tests: number;
    changed_failure_messages: number;
  } | null;
  parse_strategy: TestParseStrategy;
  parse_warnings: string[];
}

export interface StructuredTestResult {
  schema_version: typeof TEST_OUTPUT_SCHEMA_VERSION;
  summary: StructuredTestSummary;
  failures: StructuredTestIssue[];
  warnings: StructuredTestWarning[];
  parse_metadata: StructuredTestParseMetadata;
  errors: StructuredTestIssue[];
  evidence_scope?: {
    related_paths?: string[];
    related_modules?: string[];
  };
}
