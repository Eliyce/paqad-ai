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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

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
