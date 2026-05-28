// Registry of framework-shipped coverage / test-report parsers. The closed
// set mirrors the enum in src/validators/schemas/stack-pack.schema.json —
// extending it is a framework PR (spec AC #28).
//
// Each parser is a tiny `parseReport(content)` function in a sibling file.

import { parseReport as cobertura } from './cobertura.js';
import { parseReport as coveragePyXml } from './coverage-py-xml.js';
import { parseReport as gocover } from './gocover.js';
import { parseReport as goJson } from './go-json.js';
import { parseReport as jacoco } from './jacoco.js';
import { parseReport as junitXml } from './junit-xml.js';
import { parseReport as lcov } from './lcov.js';
import { parseReport as opencover } from './opencover.js';
import { parseReport as vitestJson } from './vitest-json.js';

import type { CoverageFormat, Parser } from './types.js';

export type { CoverageFormat, Parser, ParsedReport, CoverageRow, TestRow } from './types.js';

const REGISTRY: Record<CoverageFormat, Parser> = {
  lcov,
  cobertura,
  'coverage-py-xml': coveragePyXml,
  gocover,
  'junit-xml': junitXml,
  'go-json': goJson,
  jacoco,
  opencover,
  'vitest-json': vitestJson,
};

export function getParser(format: CoverageFormat): Parser | null {
  return REGISTRY[format] ?? null;
}

export function listSupportedFormats(): CoverageFormat[] {
  return Object.keys(REGISTRY) as CoverageFormat[];
}
