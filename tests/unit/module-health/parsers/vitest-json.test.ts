import { describe, expect, it } from 'vitest';

import { parseReport } from '@/module-health/parsers/vitest-json.js';

describe('module-health/parsers/vitest-json', () => {
  it('counts assertion statuses per test file', () => {
    const report = JSON.stringify({
      testResults: [
        {
          name: '/abs/path/foo.test.ts',
          assertionResults: [
            { status: 'passed' },
            { status: 'passed' },
            { status: 'failed' },
            { status: 'skipped' },
          ],
        },
        {
          name: '/abs/path/bar.test.ts',
          assertionResults: [{ status: 'passed' }],
        },
      ],
    });
    expect(parseReport(report).tests).toEqual([
      { file: '/abs/path/foo.test.ts', passing: 2, failing: 1, total: 3 },
      { file: '/abs/path/bar.test.ts', passing: 1, failing: 0, total: 1 },
    ]);
  });

  it('falls back to num{Passing,Failing}Tests when assertionResults missing', () => {
    const report = JSON.stringify({
      testResults: [
        { name: '/x.test.ts', numPassingTests: 4, numFailingTests: 1 },
      ],
    });
    expect(parseReport(report).tests).toEqual([
      { file: '/x.test.ts', passing: 4, failing: 1, total: 5 },
    ]);
  });

  it('returns empty tests on malformed JSON', () => {
    expect(parseReport('garbage').tests).toEqual([]);
  });
});
