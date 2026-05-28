// Shared parser types for the test-driven module-health rollup engine.
// Issue #80, Phase 3 — every framework-shipped parser exports a
// `parseReport(content: string): ParsedReport` function from a sibling file
// named after the closed enum in stack-pack.schema.json (the same set as
// `module_health.coverage_format` / `test_report_format`):
//
//   lcov · cobertura · coverage-py-xml · gocover · junit-xml ·
//   go-json · jacoco · opencover · vitest-json
//
// Extending the set is a framework PR: there is no project-side loader (spec
// AC #28).

export type CoverageFormat =
  | 'lcov'
  | 'cobertura'
  | 'coverage-py-xml'
  | 'gocover'
  | 'junit-xml'
  | 'go-json'
  | 'jacoco'
  | 'opencover'
  | 'vitest-json';

// Coverage signal for a single source file, normalised to forward slashes and
// project-root-relative when the parser can resolve it.
export interface CoverageRow {
  file: string;
  lines_total: number;
  lines_covered: number;
}

// Test outcome for a single source file. `file` is best-effort: some report
// formats only carry suite / class names. When a parser cannot map a result
// to a source file, it emits the row with an empty `file` and the rollup
// engine folds it into the unattributed bucket.
export interface TestRow {
  file: string;
  passing: number;
  failing: number;
  total: number;
}

export interface ParsedReport {
  coverage?: CoverageRow[];
  tests?: TestRow[];
}

export type Parser = (content: string) => ParsedReport;
