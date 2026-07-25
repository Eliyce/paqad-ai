// Compute the change-shape metrics (issue #362).
//
// Pure fold over two caches the completion gates already produced — the #358 duplication
// report and the #353 code-knowledge index — plus the change's meaningful added-line count.
// No second scan, no model, no network (INV-3). Both metrics degrade to `null` (n/a) when
// their source cache is absent or there are no meaningful changed lines, so an unbuilt index
// or a duplication-off project reads honestly rather than as a misleading 0 (FR-2).

import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { readDuplicationReport } from '@/duplication/report.js';
import type { DuplicationFinding } from '@/duplication/types.js';

import { countMeaningfulChangedLines } from './meaningful-lines.js';
import type { ChangeMetrics } from './types.js';

export interface ComputeChangeMetricsOptions {
  projectRoot: string;
  changedFiles: string[];
}

/** Normalize a path to the project-relative, forward-slash form the caches store. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Round to one decimal place (6.0 stays 6, 4.25 → 4.3). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Distinct changed-file lines covered by a duplication finding span. Findings can overlap
 * (two near-copies sharing lines) or repeat a file, so spans are unioned per file into a set
 * of line numbers rather than summed — a line never counts twice.
 */
export function flaggedNewCodeLines(findings: readonly DuplicationFinding[]): number {
  const byFile = new Map<string, Set<number>>();
  for (const finding of findings) {
    const file = normalizePath(finding.file);
    let lines = byFile.get(file);
    if (!lines) {
      lines = new Set<number>();
      byFile.set(file, lines);
    }
    for (let line = finding.line_range.start; line <= finding.line_range.end; line++) {
      lines.add(line);
    }
  }
  let total = 0;
  for (const lines of byFile.values()) {
    total += lines.size;
  }
  return total;
}

/**
 * Cross-file reuse calls the change makes: reference edges whose source is a changed file and
 * whose target is a file NOT touched by this change (a pre-existing symbol the new code calls).
 * This is GitClear's "cross-file calls" signal (which fell 35% industry-wide since 2023),
 * scoped to one change.
 */
export function crossFileReuseCalls(
  index: CodeKnowledgeIndex,
  changedFiles: readonly string[],
): number {
  const changed = new Set(changedFiles.map(normalizePath));
  let calls = 0;
  for (const edge of index.reference_edges) {
    if (changed.has(normalizePath(edge.from)) && !changed.has(normalizePath(edge.to))) {
      calls += 1;
    }
  }
  return calls;
}

/**
 * Compute the change-shape metrics for a change. `dup_new_pct` folds the duplication cache's
 * flagged span lines over meaningful changed lines (clamped to [0, 100]); `reuse_rate` folds
 * the index's cross-file reuse calls per 100 meaningful changed lines. Either is `null` when
 * its source is absent or there are no meaningful changed lines.
 */
export async function computeChangeMetrics(
  options: ComputeChangeMetricsOptions,
): Promise<ChangeMetrics> {
  const meaningful = await countMeaningfulChangedLines(options);

  const report = readDuplicationReport(options.projectRoot);
  const flaggedLines = report ? flaggedNewCodeLines(report.findings) : 0;

  const index = readCodeKnowledgeIndex(options.projectRoot);
  const reuseCalls = index ? crossFileReuseCalls(index, options.changedFiles) : 0;

  const dupNewPct =
    report && meaningful > 0
      ? Math.min(100, Math.max(0, round1((flaggedLines / meaningful) * 100)))
      : null;
  const reuseRate = index && meaningful > 0 ? round1((reuseCalls / meaningful) * 100) : null;

  return {
    dup_new_pct: dupNewPct,
    reuse_rate: reuseRate,
    meaningful_changed_lines: meaningful,
    inputs: {
      flagged_lines: flaggedLines,
      reuse_calls: reuseCalls,
      duplication_report_present: report !== null,
      index_present: index !== null,
    },
  };
}
