import type { StructuredTestFormat } from '@/core/types/pack.js';

export const TEST_OUTPUT_SMOKE_FIXTURES: Record<StructuredTestFormat, string> = {
  'jest-json': JSON.stringify({
    startTime: 1712500000000,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [
      {
        name: 'src/math.test.ts',
        assertionResults: [
          {
            ancestorTitles: ['math'],
            title: 'adds',
            fullName: 'math adds',
            status: 'passed',
            failureMessages: [],
            duration: 5,
          },
        ],
      },
    ],
  }),
  'junit-xml': `<testsuite tests="1" failures="0" errors="0" skipped="0" time="0.01">
  <testcase classname="MathTest" name="adds" time="0.01" file="tests/MathTest.php" line="10"></testcase>
</testsuite>`,
  'pytest-json': JSON.stringify({
    created: '2024-04-01T10:00:00Z',
    duration: 0.1,
    summary: { total: 1, passed: 1, failed: 0, skipped: 0, error: 0 },
    tests: [
      { nodeid: 'tests/test_math.py::test_adds', outcome: 'passed', call: { duration: 0.1 } },
    ],
  }),
  'go-json': `{"Time":"2024-04-01T10:00:00Z","Action":"run","Package":"pkg/math","Test":"TestAdds"}
{"Time":"2024-04-01T10:00:00Z","Action":"pass","Package":"pkg/math","Test":"TestAdds","Elapsed":0.01}`,
  'rspec-json': JSON.stringify({
    summary: { example_count: 1, failure_count: 0, pending_count: 0, duration: 0.1 },
    examples: [{ id: './spec/math_spec.rb[1:1]', full_description: 'math adds', status: 'passed' }],
  }),
  tap: `TAP version 13
1..1
ok 1 - math adds`,
  none: `PASS src/math.test.ts
Tests: 1 passed
Time: 0.01s`,
};
