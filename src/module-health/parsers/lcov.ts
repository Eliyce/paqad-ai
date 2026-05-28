// LCOV info-file parser. Format reference:
//   https://github.com/linux-test-project/lcov/blob/master/man/geninfo.1
//
// Each record is bounded by SF:<path> ... end_of_record. We read LF: (lines
// found) and LH: (lines hit) for each record. Branch / function metrics are
// ignored — module-health rolls up to a single coverage_pct per file.

import type { ParsedReport } from './types.js';

export function parseReport(content: string): ParsedReport {
  const coverage: ParsedReport['coverage'] = [];
  let currentFile: string | null = null;
  let linesFound = 0;
  let linesHit = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3).trim().replace(/\\/g, '/');
      linesFound = 0;
      linesHit = 0;
      continue;
    }
    if (line.startsWith('LF:')) {
      linesFound = Number.parseInt(line.slice(3), 10);
      if (!Number.isFinite(linesFound)) linesFound = 0;
      continue;
    }
    if (line.startsWith('LH:')) {
      linesHit = Number.parseInt(line.slice(3), 10);
      if (!Number.isFinite(linesHit)) linesHit = 0;
      continue;
    }
    if (line === 'end_of_record') {
      if (currentFile !== null) {
        coverage.push({
          file: currentFile,
          lines_total: linesFound,
          lines_covered: linesHit,
        });
      }
      currentFile = null;
      linesFound = 0;
      linesHit = 0;
    }
  }

  return { coverage };
}
