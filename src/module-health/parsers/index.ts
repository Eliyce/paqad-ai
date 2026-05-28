// Registry of framework-shipped coverage / test-report parsers. The closed
// set mirrors the enum in src/validators/schemas/stack-pack.schema.json —
// extending it is a framework PR (spec AC #28).
//
// Each parser is a tiny `parseReport(content)` function in a sibling file.
// Parsers that do not exist yet throw at lookup time so the rollup engine can
// surface a clean `blocked_metrics` reason instead of misreporting zero.

import { parseReport as lcov } from './lcov.js';

import type { CoverageFormat, Parser } from './types.js';

export type { CoverageFormat, Parser, ParsedReport, CoverageRow, TestRow } from './types.js';

const REGISTRY: Partial<Record<CoverageFormat, Parser>> = {
  lcov,
};

export function getParser(format: CoverageFormat): Parser | null {
  return REGISTRY[format] ?? null;
}

export function listSupportedFormats(): CoverageFormat[] {
  return Object.keys(REGISTRY) as CoverageFormat[];
}
