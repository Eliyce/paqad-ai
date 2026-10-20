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
