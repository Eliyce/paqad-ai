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

export interface CoverageRow {
  file: string;
  lines_total: number;
  lines_covered: number;
}

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
