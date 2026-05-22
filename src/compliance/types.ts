export type ObligationCategory =
  | 'functional'
  | 'edge-case'
  | 'acceptance'
  | 'non-functional'
  | 'unclassified';

export type ComplianceState = 'covered' | 'partial' | 'uncovered' | 'indeterminate';
export type SpecDefectSeverity = 'critical' | 'major' | 'minor';
export type SpecReviewDefectCategory =
  | 'contradiction'
  | 'formula_inconsistency'
  | 'boundary_gap'
  | 'goal_conflict'
  | 'dangling_reference'
  | 'missing_negative_case'
  | 'unresolvable_reference';
export type SpecReviewDefectStatus = 'new' | 'existing' | 'resolved';

export interface Obligation {
  obligation_id: string;
  category: ObligationCategory;
  description: string;
  pass_criteria: string | null;
  source_section: string;
  source_line: number | null;
  spec_file: string;
  affected_by_spec_defects?: string[];
}

export interface ObligationIndexMetadata {
  spec_file: string;
  spec_hash: string;
  extracted_at: string;
  obligation_count: number;
  schema_version: number;
  warnings: string[];
}

export interface ObligationIndex {
  metadata: ObligationIndexMetadata;
  obligations: Obligation[];
}

export interface ComplianceReportObligation extends Obligation {
  state: ComplianceState;
  evidence: string[];
}

export interface ComplianceReportSummary {
  total: number;
  covered: number;
  partial: number;
  uncovered: number;
  indeterminate: number;
  compliance_ratio: number;
}

export interface ComplianceReport {
  metadata: {
    spec_file: string;
    spec_hash: string;
    generated_at: string;
    schema_version: number;
    /** SHA-256 of sorted test-file contents — used for incremental cache validation (FR-3.6). */
    test_files_hash: string;
    /** True when the report was returned from cache without re-scanning (FR-3.6). */
    cache_hit: boolean;
  };
  summary: ComplianceReportSummary;
  spec_review: {
    defect_count: number;
    critical_count: number;
    warning: string | null;
  } | null;
  obligations: ComplianceReportObligation[];
  /** Convenience list of obligation IDs whose state is `uncovered` (FR-3.3). */
  uncovered_obligations: string[];
}

export interface SpecReviewLocation {
  section: string;
  line_range: [number, number];
  text_excerpt: string;
}

export interface SpecReviewDefect {
  defect_id: string;
  category: SpecReviewDefectCategory;
  severity: SpecDefectSeverity;
  description: string;
  locations: SpecReviewLocation[];
  suggested_resolution: string;
  affected_obligation_ids: string[] | null;
  status: SpecReviewDefectStatus;
}

export interface SpecPatternAdvisory {
  advisory_id: string;
  title: string;
  description: string;
}

export interface SpecReviewReportMetadata {
  spec_file: string;
  spec_hash: string;
  reviewed_at: string;
  defect_count: number;
  schema_version: number;
}

export interface SpecReviewReport {
  metadata: SpecReviewReportMetadata;
  defects: SpecReviewDefect[];
  pattern_advisories: SpecPatternAdvisory[];
}
