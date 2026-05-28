import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/lcov.js';

describe('module-health/parsers/lcov', () => {
  it('parses canonical lcov.info with multiple records', () => {
    const lcov = [
      'TN:',
      'SF:src/cli/commands/refresh.ts',
      'FN:10,refresh',
      'FNF:1',
      'FNH:1',
      'DA:10,1',
      'DA:11,0',
      'LF:10',
      'LH:7',
      'end_of_record',
      'SF:src/module-map/reconciler.ts',
      'LF:50',
      'LH:50',
      'end_of_record',
    ].join('\n');

    const report = parseReport(lcov);
    expect(report.coverage).toEqual([
      { file: 'src/cli/commands/refresh.ts', lines_total: 10, lines_covered: 7 },
      { file: 'src/module-map/reconciler.ts', lines_total: 50, lines_covered: 50 },
    ]);
  });

  it('tolerates Windows path separators by normalising to forward slashes', () => {
    const lcov = ['SF:src\\foo\\bar.ts', 'LF:4', 'LH:2', 'end_of_record'].join('\n');
    expect(parseReport(lcov).coverage).toEqual([
      { file: 'src/foo/bar.ts', lines_total: 4, lines_covered: 2 },
    ]);
  });

  it('returns an empty coverage array for empty input', () => {
    expect(parseReport('').coverage).toEqual([]);
  });

  it('ignores malformed LF/LH counters (non-numeric)', () => {
    const lcov = ['SF:src/x.ts', 'LF:NaN', 'LH:nope', 'end_of_record'].join('\n');
    expect(parseReport(lcov).coverage).toEqual([
      { file: 'src/x.ts', lines_total: 0, lines_covered: 0 },
    ]);
  });

  it('skips records without an SF: line', () => {
    const lcov = ['LF:5', 'LH:5', 'end_of_record'].join('\n');
    expect(parseReport(lcov).coverage).toEqual([]);
  });
});
