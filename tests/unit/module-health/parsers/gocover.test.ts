import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/gocover.js';

describe('module-health/parsers/gocover', () => {
  it('aggregates statement counts per file', () => {
    const profile = [
      'mode: set',
      'app/foo.go:1.2,3.4 5 1',
      'app/foo.go:4.1,6.2 3 0',
      'app/bar.go:10.1,12.3 2 1',
    ].join('\n');
    expect(parseReport(profile).coverage).toEqual([
      { file: 'app/bar.go', lines_total: 2, lines_covered: 2 },
      { file: 'app/foo.go', lines_total: 8, lines_covered: 5 },
    ]);
  });

  it('skips the mode header and blank lines', () => {
    expect(parseReport('mode: count\n\n').coverage).toEqual([]);
  });

  it('skips lines that do not match the coverage-profile shape', () => {
    const profile = ['mode: set', 'not a coverage line', 'app/x.go:1.1,2.2 1 1'].join('\n');
    expect(parseReport(profile).coverage).toEqual([
      { file: 'app/x.go', lines_total: 1, lines_covered: 1 },
    ]);
  });
});
