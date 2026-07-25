// Change-shape metrics types (issue #362).
//
// Two deterministic, diff-scoped, zero-model-token numbers computed per change: how much
// of the new code near-duplicates existing code (`dup_new_pct`, from the #358 duplication
// cache) and how much the new code reuses pre-existing project symbols (`reuse_rate`, from
// the #353 code-knowledge reference edges). Both are folds over caches the completion gates
// already produced — nothing here scans the tree a second time.

/** The two change-shape metrics plus the inputs they were derived from. */
export interface ChangeMetrics {
  /**
   * Percent of meaningful changed lines that near-duplicate existing code, in [0, 100], or
   * `null` (n/a) when the duplication report is absent or there are no meaningful changed
   * lines. 0 is good.
   */
  dup_new_pct: number | null;
  /**
   * Cross-file calls from the change's new/modified code into pre-existing (untouched) files
   * per 100 meaningful changed lines, or `null` (n/a) when the code-knowledge index is absent
   * or there are no meaningful changed lines. Higher is better.
   */
  reuse_rate: number | null;
  /** Non-blank, non-comment added/modified lines the change introduced. */
  meaningful_changed_lines: number;
  /** The raw inputs behind the ratios, so a consumer can re-derive or audit them. */
  inputs: {
    /** Distinct changed-file lines covered by a duplication finding span. */
    flagged_lines: number;
    /** Cross-file reference edges from a changed file into an untouched file. */
    reuse_calls: number;
    /** Whether the #358 duplication report was present (false ⇒ dup_new_pct is n/a). */
    duplication_report_present: boolean;
    /** Whether the #353 code-knowledge index was present (false ⇒ reuse_rate is n/a). */
    index_present: boolean;
  };
}
