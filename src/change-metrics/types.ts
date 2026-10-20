export interface ChangeMetrics {
  dup_new_pct: number | null;
  reuse_rate: number | null;
  meaningful_changed_lines: number;
  inputs: {
    flagged_lines: number;
    reuse_calls: number;
    duplication_report_present: boolean;
    index_present: boolean;
  };
}
