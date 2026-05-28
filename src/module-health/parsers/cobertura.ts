// Cobertura XML coverage parser. Format reference:
//   http://cobertura.github.io/cobertura/xml/coverage-04.dtd
//
// We aggregate <line number="N" hits="M"/> elements per <class filename="..."/>.
// Sub-element ordering does not matter — we slice each <class …> … </class>
// block and count its <line .../> entries.

import type { CoverageRow, ParsedReport } from './types.js';

const CLASS_BLOCK = /<class\b([^>]*)>([\s\S]*?)<\/class>/g;
const FILENAME_ATTR = /\bfilename="([^"]+)"/;
const LINE_TAG = /<line\b[^>]*\bhits="(\d+)"/g;

export function parseReport(content: string): ParsedReport {
  const coverage: CoverageRow[] = [];
  for (const match of content.matchAll(CLASS_BLOCK)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const filenameMatch = FILENAME_ATTR.exec(attrs);
    if (filenameMatch === null) continue;
    const filename = (filenameMatch[1] ?? '').replace(/\\/g, '/');
    let total = 0;
    let covered = 0;
    for (const lineMatch of body.matchAll(LINE_TAG)) {
      total += 1;
      if (Number.parseInt(lineMatch[1] ?? '0', 10) > 0) covered += 1;
    }
    coverage.push({ file: filename, lines_total: total, lines_covered: covered });
  }
  return { coverage };
}
