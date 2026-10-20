import type { CoverageRow, ParsedReport } from './types.js';

export function parseReport(content: string): ParsedReport {
  const byFile = new Map<string, { total: number; covered: number }>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('mode:')) continue;
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
