import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/go-json.js';

describe('module-health/parsers/go-json', () => {
  it('counts pass/fail per package', () => {
    const ndjson = [
      JSON.stringify({ Action: 'run', Package: 'x/y', Test: 'TestA' }),
      JSON.stringify({ Action: 'pass', Package: 'x/y', Test: 'TestA' }),
      JSON.stringify({ Action: 'run', Package: 'x/y', Test: 'TestB' }),
      JSON.stringify({ Action: 'fail', Package: 'x/y', Test: 'TestB' }),
      JSON.stringify({ Action: 'pass', Package: 'x/z', Test: 'TestC' }),
      'this line is not JSON',
    ].join('\n');
    expect(parseReport(ndjson).tests).toEqual([
      { file: 'x/y', passing: 1, failing: 1, total: 2 },
      { file: 'x/z', passing: 1, failing: 0, total: 1 },
    ]);
  });

  it('returns empty tests on entirely malformed input', () => {
    expect(parseReport('garbage\nmore garbage\n').tests).toEqual([]);
  });
});
