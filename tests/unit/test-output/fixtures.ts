export const TEST_OUTPUT_FIXTURES = {
  'jest-json': {
    allPass: JSON.stringify({
      startTime: 1712500000000,
      numTotalTests: 2,
      numPassedTests: 2,
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
            {
              ancestorTitles: ['math'],
              title: 'subtracts',
              fullName: 'math subtracts',
              status: 'passed',
              failureMessages: [],
              duration: 6,
            },
          ],
        },
      ],
    }),
    mixed: JSON.stringify({
      startTime: 1712500000000,
      numTotalTests: 4,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 1,
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
            {
              ancestorTitles: ['math'],
              title: 'divides',
              fullName: 'math divides',
              status: 'failed',
              failureMessages: ['Expected 4 to equal 5\n    at src/math.test.ts:14:2'],
              location: { line: 14 },
              duration: 7,
            },
            {
              ancestorTitles: ['math'],
              title: 'skips',
              fullName: 'math skips',
              status: 'pending',
              failureMessages: [],
              duration: 0,
            },
          ],
        },
      ],
    }),
  },
  'junit-xml': {
    allPass: `<testsuite tests="2" failures="0" errors="0" skipped="0" time="0.02">
  <testcase classname="MathTest" name="adds" time="0.01" file="tests/MathTest.php" line="10"></testcase>
  <testcase classname="MathTest" name="subtracts" time="0.01" file="tests/MathTest.php" line="18"></testcase>
</testsuite>`,
    mixed: `<testsuite tests="3" failures="1" errors="1" skipped="1" time="0.05">
  <testcase classname="MathTest" name="adds" time="0.01" file="tests/MathTest.php" line="10"></testcase>
  <testcase classname="MathTest" name="divides" time="0.02" file="tests/MathTest.php" line="20">
    <failure message="Expected 4 to equal 5">Assertion failed at tests/MathTest.php:20</failure>
  </testcase>
  <testcase classname="MathTest" name="throws" time="0.02" file="tests/MathTest.php" line="30">
    <error message="Unhandled exception">RuntimeException: boom</error>
  </testcase>
  <testcase classname="MathTest" name="skips" time="0.00" file="tests/MathTest.php" line="40">
    <skipped>not applicable</skipped>
  </testcase>
</testsuite>`,
  },
  'pytest-json': {
    allPass: JSON.stringify({
      created: '2024-04-01T10:00:00Z',
      duration: 0.2,
      summary: { total: 2, passed: 2, failed: 0, skipped: 0, error: 0 },
      tests: [
        { nodeid: 'tests/test_math.py::test_adds', outcome: 'passed', call: { duration: 0.1 } },
        {
          nodeid: 'tests/test_math.py::test_subtracts',
          outcome: 'passed',
          call: { duration: 0.1 },
        },
      ],
    }),
    mixed: JSON.stringify({
      created: '2024-04-01T10:00:00Z',
      duration: 0.4,
      summary: { total: 4, passed: 1, failed: 1, skipped: 1, error: 1 },
      tests: [
        { nodeid: 'tests/test_math.py::test_adds', outcome: 'passed', call: { duration: 0.1 } },
        {
          nodeid: 'tests/test_math.py::test_divides',
          outcome: 'failed',
          lineno: 12,
          call: { longrepr: 'assert 4 == 5', duration: 0.1 },
        },
        {
          nodeid: 'tests/test_math.py::test_throws',
          outcome: 'error',
          call: {
            crash: { message: 'RuntimeError: boom', path: 'tests/test_math.py', lineno: 20 },
            longrepr: 'RuntimeError: boom',
            duration: 0.1,
          },
        },
        { nodeid: 'tests/test_math.py::test_skips', outcome: 'skipped', call: { duration: 0 } },
      ],
    }),
  },
  'go-json': {
    allPass: `{"Time":"2024-04-01T10:00:00Z","Action":"run","Package":"pkg/math","Test":"TestAdds"}
{"Time":"2024-04-01T10:00:00Z","Action":"pass","Package":"pkg/math","Test":"TestAdds","Elapsed":0.01}
{"Time":"2024-04-01T10:00:00Z","Action":"run","Package":"pkg/math","Test":"TestSubtracts"}
{"Time":"2024-04-01T10:00:00Z","Action":"pass","Package":"pkg/math","Test":"TestSubtracts","Elapsed":0.02}`,
    mixed: `{"Time":"2024-04-01T10:00:00Z","Action":"run","Package":"pkg/math","Test":"TestAdds"}
{"Time":"2024-04-01T10:00:00Z","Action":"pass","Package":"pkg/math","Test":"TestAdds","Elapsed":0.01}
{"Time":"2024-04-01T10:00:00Z","Action":"run","Package":"pkg/math","Test":"TestDivides"}
{"Time":"2024-04-01T10:00:00Z","Action":"output","Package":"pkg/math","Test":"TestDivides","Output":"expected 4 to equal 5\\n"}
{"Time":"2024-04-01T10:00:00Z","Action":"fail","Package":"pkg/math","Test":"TestDivides","Elapsed":0.02}
{"Time":"2024-04-01T10:00:00Z","Action":"run","Package":"pkg/math","Test":"TestSkips"}
{"Time":"2024-04-01T10:00:00Z","Action":"skip","Package":"pkg/math","Test":"TestSkips","Elapsed":0.00}`,
  },
  'rspec-json': {
    allPass: JSON.stringify({
      summary: { example_count: 2, failure_count: 0, pending_count: 0, duration: 0.2 },
      examples: [
        { id: './spec/math_spec.rb[1:1]', full_description: 'math adds', status: 'passed' },
        {
          id: './spec/math_spec.rb[1:2]',
          full_description: 'math subtracts',
          status: 'passed',
        },
      ],
    }),
    mixed: JSON.stringify({
      summary: { example_count: 3, failure_count: 1, pending_count: 1, duration: 0.3 },
      examples: [
        { id: './spec/math_spec.rb[1:1]', full_description: 'math adds', status: 'passed' },
        {
          id: './spec/math_spec.rb[1:2]',
          full_description: 'math divides',
          status: 'failed',
          file_path: './spec/math_spec.rb',
          line_number: 14,
          run_time: 0.1,
          exception: {
            message: 'expected: 5\n     got: 4',
            backtrace: ['./spec/math_spec.rb:14'],
          },
        },
        { id: './spec/math_spec.rb[1:3]', full_description: 'math skips', status: 'pending' },
      ],
    }),
  },
  tap: {
    allPass: `TAP version 13
1..2
ok 1 - math adds
ok 2 - math subtracts`,
    mixed: `TAP version 13
1..3
ok 1 - math adds
not ok 2 - math divides
# Expected 4 to equal 5
ok 3 - math skips # SKIP not relevant`,
  },
  'plain-text': {
    allPass: `PASS src/math.test.ts
Tests: 2 passed
Time: 0.12s`,
    mixed: `FAIL src/math.test.ts
Expected 4 to equal 5
    at src/math.test.ts:14:2
ERROR connection bootstrap
RuntimeError: boom
Tests: 1 passed, 1 failed, 1 error, 1 skipped
Time: 0.25s`,
  },
} as const;
