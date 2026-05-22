import { parseTestOutput } from '@/test-output/index.js';

describe('test-output parser branch coverage', () => {
  it('prefers Jest numPendingTests over loop-derived skipped count when present', async () => {
    const jestJson = JSON.stringify({
      startTime: 1700000000000,
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 7,
      testResults: [
        {
          name: '/tmp/suite.test.ts',
          assertionResults: [
            { status: 'skipped', title: 'skipped test', ancestorTitles: ['suite'] },
            { status: 'passed', title: 'passed test', ancestorTitles: ['suite'] },
          ],
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'jest', structured_format: 'jest-json' },
      stdout: jestJson,
    });

    expect(result.summary.skipped).toBe(7);
    expect(result.parse_metadata.parse_strategy).toBe('structured');
  });

  it('covers Jest parser fallbacks when assertion results and failure messages are missing', async () => {
    const jestJson = JSON.stringify({
      startTime: 1700000000000,
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      // Intentionally omit numPendingTests so skipped falls back to loop count (0 here).
      testResults: [
        // Intentionally omit assertionResults to hit the `?? []` fallback.
        { name: '/tmp/suite-without-assertions.test.ts' },
        {
          name: '/tmp/suite-with-assertions.test.ts',
          assertionResults: [
            // Intentionally omit failureMessages and set status to null so message falls back to `Test unknown`.
            { title: 'mystery test', status: null },
            // Include a real failing assertion so we get at least one emitted failure.
            { title: 'explicit failure', status: 'failed' },
          ],
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'jest', structured_format: 'jest-json' },
      stdout: jestJson,
    });

    expect(result.parse_metadata.parse_strategy).toBe('structured');
    expect(result.summary.failed).toBeGreaterThan(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toContain('Test failed');
  });

  it('classifies pytest outcomes as error vs assertion based on outcome and content', async () => {
    const pytestJson = JSON.stringify({
      created: '2026-04-07T12:00:00Z',
      duration: 0.01,
      summary: { total: 2, failed: 1, error: 1 },
      tests: [
        {
          nodeid: 'tests/test_mod.py::test_failed',
          outcome: 'failed',
          lineno: 12,
          call: { longrepr: 'assert 1 == 2', duration: 0.001 },
        },
        {
          nodeid: 'tests/test_mod.py::test_error',
          outcome: 'error',
          lineno: 34,
          call: { crash: { message: 'Exception: boom', path: 'tests/test_mod.py', lineno: 34 } },
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
      stdout: pytestJson,
    });

    expect(result.summary.failed).toBeGreaterThan(0);
    expect(result.summary.errored).toBeGreaterThan(0);
    expect(result.failures[0]?.category).toBe('assertion');
    expect(result.errors[0]?.category).toBe('error');
  });

  it('covers pytest detail fallback to unknown when no call details or outcome exist', async () => {
    const pytestJson = JSON.stringify({
      tests: [
        {
          // Intentionally omit nodeid/call/outcome to hit all fallbacks.
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'pytest', structured_format: 'pytest-json' },
      stdout: pytestJson,
    });

    expect(result.failures).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    // The parser should still emit a deterministic summary object.
    expect(result.summary.total).toBeGreaterThanOrEqual(0);
  });

  it('handles go json events where Action is not a string', async () => {
    const goJson = [
      JSON.stringify({ Test: 'TestA', Action: 'pass', Elapsed: 0.01, Output: 'ok' }),
      JSON.stringify({ Test: 'TestB', Action: 123, Elapsed: 0.01, Output: 'weird' }),
    ].join('\n');

    const result = await parseTestOutput({
      runner: { runner_id: 'go-test', structured_format: 'go-json' },
      stdout: goJson,
    });

    expect(result.parse_metadata.parse_strategy).toBe('structured');
    expect(result.summary.total).toBe(1);
    expect(result.summary.passed).toBe(1);
  });

  it('covers junit failure/error category fallbacks when message and content are empty', async () => {
    const junitXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuite name="suite" tests="2" failures="1" errors="1" time="0.0">',
      '  <testcase classname="C" name="t-failure" time="0.0" file="a.php" line="12">',
      '    <failure></failure>',
      '  </testcase>',
      '  <testcase classname="C" name="t-error" time="0.0" file="a.php" line="13">',
      '    <error></error>',
      '  </testcase>',
      '</testsuite>',
    ].join('\n');

    const result = await parseTestOutput({
      runner: { runner_id: 'phpunit', structured_format: 'junit-xml' },
      stdout: junitXml,
    });

    expect(result.summary.failed).toBe(1);
    expect(result.summary.errored).toBe(1);
    expect(result.failures[0]?.category).toBe('assertion');
    expect(result.errors[0]?.category).toBe('error');
  });

  it('covers rspec failure fallbacks and summary total fallback to examples length', async () => {
    const rspecJson = JSON.stringify({
      summary: {
        // Intentionally omit example_count so total falls back to examples length.
        failure_count: 1,
        pending_count: 0,
        duration: 0.0,
      },
      examples: [
        {
          id: 'rspec-1',
          full_description: 'fails without exception message',
          status: 'failed',
          file_path: 'spec/example_spec.rb',
          line_number: 10,
          // Intentionally omit exception to hit message fallback and null stack trace path.
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'rspec', structured_format: 'rspec-json' },
      stdout: rspecJson,
    });

    expect(result.summary.total).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.failures[0]?.message).toContain('RSpec example failed');
  });

  it('covers rspec null fallbacks for file path and line number', async () => {
    const rspecJson = JSON.stringify({
      summary: { example_count: 1, failure_count: 1, pending_count: 0, duration: 0.0 },
      examples: [
        {
          id: 'rspec-2',
          status: 'failed',
          exception: { message: 'expected mismatch', backtrace: ['line1'] },
          // Intentionally omit file_path and line_number so the parser emits nulls.
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'rspec', structured_format: 'rspec-json' },
      stdout: rspecJson,
    });

    expect(result.failures[0]?.file_path).toBe(null);
    expect(result.failures[0]?.line_number).toBe(null);
  });

  it('covers rspec test id fallback to unknown-test when ids are missing', async () => {
    const rspecJson = JSON.stringify({
      summary: { example_count: 1, failure_count: 1, pending_count: 0, duration: 0.0 },
      examples: [
        {
          status: 'failed',
          exception: { message: 'boom' },
        },
      ],
    });

    const result = await parseTestOutput({
      runner: { runner_id: 'rspec', structured_format: 'rspec-json' },
      stdout: rspecJson,
    });

    expect(result.failures[0]?.test_id).toBe('unknown-test');
  });

  it('covers junit failure/error branches when message attributes are present', async () => {
    const junitXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuite name="suite" tests="2" failures="1" errors="1" time="0.0">',
      '  <testcase classname="C" name="t-failure" time="0.0" file="a.php" line="12">',
      '    <failure message="expected 1 to equal 2">assert</failure>',
      '  </testcase>',
      '  <testcase classname="C" name="t-error" time="0.0" file="a.php" line="13">',
      '    <error message="Exception: boom">stack</error>',
      '  </testcase>',
      '</testsuite>',
    ].join('\n');

    const result = await parseTestOutput({
      runner: { runner_id: 'phpunit', structured_format: 'junit-xml' },
      stdout: junitXml,
    });

    expect(result.summary.failed).toBe(1);
    expect(result.summary.errored).toBe(1);
    expect(result.failures[0]?.category).toBe('assertion');
    expect(result.errors[0]?.category).toBe('error');
  });
});
