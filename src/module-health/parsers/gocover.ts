// Go coverage profile parser. Format produced by `go test -coverprofile`:
//
//   mode: set
//   path/to/file.go:1.2,3.4 5 1
//   path/to/file.go:6.7,8.9 3 0
//
// Each non-header line is: <file>:<startLine.startCol,endLine.endCol>
// <numStatements> <count>. We aggregate per-file statement counts as
// lines_total and treat blocks with count>0 as fully covered, blocks with
// count==0 as fully uncovered. Statements are the closest analogue to lines
// in the Go coverage model.

import type { CoverageRow, ParsedReport } from './types.js';

export function parseReport(content: string): ParsedReport {
  const byFile = new Map<string, { total: number; covered: number }>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('mode:')) continue;
    // file:startLine.startCol,endLine.endCol numStatements count
    const match = /^(.+?):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/.exec(line);
    if (match === null) continue;
    const file = (match[1] ?? '').replace(/\\/g, '/');
    const stmts = Number.parseInt(match[2] ?? '0', 10);
    const count = Number.parseInt(match[3] ?? '0', 10);
    const acc = byFile.get(file) ?? { total: 0, covered: 0 };
    acc.total += stmts;
    if (count > 0) acc.covered += stmts;
    byFile.set(file, acc);
  }
  const coverage: CoverageRow[] = [];
  for (const [file, { total, covered }] of byFile) {
    coverage.push({ file, lines_total: total, lines_covered: covered });
  }
  coverage.sort((a, b) => a.file.localeCompare(b.file));
  return { coverage };
}
