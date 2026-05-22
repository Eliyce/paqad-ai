import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __testOutputInternals, parseTestOutput } from '@/test-output/index.js';

import { TEST_OUTPUT_FIXTURES } from './fixtures.js';

describe('test-output internals', () => {
  it('returns a degraded result when no output is available', async () => {
    const result = await parseTestOutput({
      runner: { runner_id: 'jest', structured_format: 'jest-json', output_source: 'file' },
    });

    expect(result.parse_metadata.parse_strategy).toBe('degraded');
    expect(result.parse_metadata.escalation_occurred).toBe(true);
    expect(result.parse_metadata.escalation_reason).toBe('structured-parse-failed-or-degraded');
    expect(result.parse_metadata.original_size).toBe(0);
    expect(result.parse_metadata.compact_size).toBeGreaterThan(0);
    expect(result.parse_metadata.parse_warnings).toContain(
      'No test output found for runner "jest"',
    );
  });

  it('collects stdout and stderr together and reads file outputs in sorted order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-collect-'));
    writeFileSync(join(root, 'b.txt'), 'second');
    writeFileSync(join(root, 'a.txt'), 'first');

    try {
      await expect(
        __testOutputInternals.collectRawSources({
          runner: { runner_id: 'jest', structured_format: 'jest-json' },
          stdout: Buffer.from('stdout'),
          stderr: 'stderr',
        }),
      ).resolves.toEqual(['stdout\nstderr']);
      await expect(
        __testOutputInternals.collectRawSources({
          runner: { runner_id: 'jest', structured_format: 'jest-json' },
          stdout: '   ',
          stderr: '',
        }),
      ).resolves.toEqual([]);

      await expect(
        __testOutputInternals.collectRawSources({
          cwd: root,
          runner: {
            runner_id: 'phpunit',
            structured_format: 'junit-xml',
            output_source: 'file',
            output_path_pattern: '*.txt',
          },
        }),
      ).resolves.toEqual(['first', 'second']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes direct structured parser coverage for the none fallback and invalid xml path', () => {
    expect(
      __testOutputInternals.parsePlainTextFallback(
        TEST_OUTPUT_FIXTURES['plain-text'].allPass,
        'vitest',
      ),
    ).toMatchObject({
      summary: expect.objectContaining({ passed: 2 }),
    });

    expect(() => __testOutputInternals.parseJunitXml('<root></root>', 'phpunit')).toThrowError(
      'Not valid JUnit XML',
    );
  });

  it('throws for unsupported structured formats', () => {
    expect(() =>
      __testOutputInternals.parseStructuredByFormat('{}', {
        runner_id: 'custom',
        structured_format: 'unsupported-format' as never,
      }),
    ).toThrowError('Unsupported structured format "unsupported-format"');
  });

  it('covers helper branches for classification, normalization, numeric parsing, and dedupe', () => {
    expect(__testOutputInternals.selectDominantStrategy('structured', 'degraded')).toBe('degraded');
    expect(__testOutputInternals.selectDominantStrategy('plain-text-fallback', 'structured')).toBe(
      'plain-text-fallback',
    );

    expect(__testOutputInternals.classifyIssue('test timed out', 'unknown')).toBe('timeout');
    expect(__testOutputInternals.classifyIssue('panic: bad', 'unknown')).toBe('error');
    expect(__testOutputInternals.classifyIssue('assert mismatch', 'unknown')).toBe('assertion');
    expect(__testOutputInternals.classifyIssue('plain note', 'unknown')).toBe('unknown');

    expect(__testOutputInternals.normalizeRawOutput('\u001b[31mFAIL\u001b[2K\r\u001b[A')).toBe(
      'FAIL',
    );
    expect(__testOutputInternals.toUtf8String(undefined)).toBe('');
    expect(__testOutputInternals.toUtf8String(Buffer.from('buf'))).toBe('buf');
    expect(__testOutputInternals.toMilliseconds('nope')).toBeNull();
    expect(__testOutputInternals.toMilliseconds('0.02')).toBe(20);
    expect(__testOutputInternals.toMilliseconds(12)).toBe(12000);
    expect(__testOutputInternals.toMilliseconds(0.5)).toBe(500);
    expect(__testOutputInternals.toInteger(4)).toBe(4);
    expect(__testOutputInternals.toInteger('7')).toBe(7);
    expect(__testOutputInternals.toInteger('bad')).toBeNull();
    expect(__testOutputInternals.toIsoTimestamp(undefined)).toBe('1970-01-01T00:00:00.000Z');
    expect(__testOutputInternals.toIsoTimestamp(undefined)).toBe('1970-01-01T00:00:00.000Z');
    expect(__testOutputInternals.normalizeTimestamp(undefined)).toBe('1970-01-01T00:00:00.000Z');
    expect(__testOutputInternals.normalizeTimestamp('not-a-date')).toBe('1970-01-01T00:00:00.000Z');
    expect(__testOutputInternals.normalizeTimestamp('2024-01-01T00:00:00Z')).toBe(
      '2024-01-01T00:00:00.000Z',
    );

    expect(__testOutputInternals.extractSummaryCount(['passed 3'], 'passed')).toBe(3);
    expect(__testOutputInternals.extractSummaryCount(['3 passed'], 'passed')).toBe(3);
    expect(__testOutputInternals.extractSummaryCount(['nothing'], 'passed')).toBe(0);
    expect(__testOutputInternals.extractDurationMs(['Time: 250ms'])).toBe(250);
    expect(__testOutputInternals.extractDurationMs(['none'])).toBeNull();

    expect(__testOutputInternals.isRunnerEnvelope('....')).toBe(true);
    expect(__testOutputInternals.isRunnerEnvelope('coverage =====')).toBe(false);
    expect(__testOutputInternals.isRunnerEnvelope('Statements : 90%')).toBe(true);

    expect(__testOutputInternals.parseXmlAttributes('<testcase file="a" line="b">')).toEqual({
      file: 'a',
      line: 'b',
    });
    expect(__testOutputInternals.extractTag('<failure>bad</failure>', 'failure')).toEqual({
      message: null,
      content: 'bad',
    });
    expect(
      __testOutputInternals.extractTag('<skipped message="not applicable" />', 'skipped'),
    ).toEqual({
      message: 'not applicable',
      content: '',
    });
    expect(__testOutputInternals.extractTag('<testcase></testcase>', 'failure')).toBeNull();
    expect(__testOutputInternals.decodeXmlEntities('&lt;&amp;&gt;&quot;&apos;')).toBe('<&>"\'');

    expect(
      __testOutputInternals.dedupeWarnings([
        { type: 'warning', message: 'dup', source_test_id: null },
        { type: 'warning', message: 'dup', source_test_id: null },
        { type: 'warning', message: 'uniq', source_test_id: 't1' },
      ]),
    ).toEqual([
      { type: 'warning', message: 'dup', source_test_id: null },
      { type: 'warning', message: 'uniq', source_test_id: 't1' },
    ]);
    expect(__testOutputInternals.dedupeStrings(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(__testOutputInternals.formatErrorMessage(new Error('boom'))).toBe('boom');
    expect(__testOutputInternals.formatErrorMessage('boom')).toBe('boom');
  });

  it('covers parser-specific warning and fallback branches', () => {
    const tapWarnings = __testOutputInternals.parseTap(
      '# suite note\nnot ok 1 - bad\n# stack',
      'tap-runner',
    );
    expect(tapWarnings.warnings).toEqual([
      { type: 'tap-note', message: 'suite note', source_test_id: null },
    ]);

    const junitWarnings = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase classname="Suite" name="works"><system-err>stderr</system-err></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitWarnings.warnings).toEqual([
      { type: 'runner-stderr', message: 'stderr', source_test_id: 'Suite::works' },
    ]);

    const plainText = __testOutputInternals.parsePlainTextFallback(
      `warning: deprecated\n\n1) numbered failure\n    at stack\nTime: 0.3s`,
      'plain',
    );
    expect(plainText.warnings).toEqual([
      { type: 'warning', message: 'warning: deprecated', source_test_id: null },
    ]);
    expect(plainText.summary.duration_ms).toBe(300);

    const junitError = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase classname="Suite" name="fails" line="7"><error>   </error></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitError.errors).toEqual([
      expect.objectContaining({
        test_id: 'Suite::fails',
        message: 'Test errored',
        category: 'error',
        line_number: 7,
      }),
    ]);

    const junitFailureDefaults = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase name="fails"><failure message=""></failure></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitFailureDefaults.failures).toEqual([
      expect.objectContaining({
        suite: null,
        message: 'Test failed',
        stack_trace: null,
        category: 'assertion',
      }),
    ]);

    const junitFailureMessageOnly = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase name="fails"><failure message="explicit failure"></failure></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitFailureMessageOnly.failures).toEqual([
      expect.objectContaining({
        message: 'explicit failure',
        stack_trace: null,
      }),
    ]);

    const junitFailureEmptyContent = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase name="fails"><failure></failure></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitFailureEmptyContent.failures).toEqual([
      expect.objectContaining({
        message: 'Test failed',
        category: 'assertion',
      }),
    ]);

    const junitErrorDefaults = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase name="errors"><error message=""></error></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitErrorDefaults.errors).toEqual([
      expect.objectContaining({
        suite: null,
        message: 'Test errored',
        stack_trace: null,
        category: 'error',
      }),
    ]);

    const junitErrorMessageOnly = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase name="errors"><error message="explicit error"></error></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitErrorMessageOnly.errors).toEqual([
      expect.objectContaining({
        message: 'explicit error',
        stack_trace: null,
      }),
    ]);

    const junitErrorEmptyContent = __testOutputInternals.parseJunitXml(
      `<testsuite tests="1"><testcase name="errors"><error></error></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitErrorEmptyContent.errors).toEqual([
      expect.objectContaining({
        message: 'Test errored',
        category: 'error',
      }),
    ]);
  });

  it('covers parser edge cases with missing fields and fallback defaults', () => {
    const emptyJest = __testOutputInternals.parseJestJson(JSON.stringify({}), 'jest');
    expect(emptyJest.summary.total).toBe(0);

    const jestResult = __testOutputInternals.parseJestJson(
      JSON.stringify({
        numPassedTests: 1,
        testResults: [
          { name: 'suite.test.ts', assertionResults: [{ title: 'works', status: 'skipped' }] },
          { name: 'suite-only.test.ts', assertionResults: [{ status: 'failed' }] },
          { assertionResults: [{ status: 'failed' }] },
        ],
      }),
      'jest',
    );
    expect(jestResult.summary.timestamp).toBe('1970-01-01T00:00:00.000Z');
    expect(jestResult.summary.total).toBe(4);
    expect(jestResult.summary.skipped).toBe(1);
    expect(jestResult.failures.map((failure) => failure.test_id)).toEqual([
      'suite-only.test.ts',
      'unknown-test',
    ]);

    const pytestResult = __testOutputInternals.parsePytestJson(
      JSON.stringify({
        tests: [{ outcome: 'passed', lineno: 5, call: { duration: 0.02 } }],
      }),
      'pytest',
    );
    expect(pytestResult.summary.total).toBe(1);
    expect(pytestResult.summary.duration_ms).toBe(0);
    expect(__testOutputInternals.parsePytestJson(JSON.stringify({}), 'pytest').summary.total).toBe(
      0,
    );

    const rspecResult = __testOutputInternals.parseRspecJson(
      JSON.stringify({ summary: { example_count: 1 }, examples: [{ status: 'passed' }] }),
      'rspec',
    );
    expect(rspecResult.summary.total).toBe(1);
    expect(rspecResult.summary.passed).toBe(1);
    expect(__testOutputInternals.parseRspecJson(JSON.stringify({}), 'rspec').summary.total).toBe(0);

    const goResult = __testOutputInternals.parseGoJson(
      `{"Action":"output","Output":"booting"}\n{"Action":"pass","Test":"TestOnly","Elapsed":12}`,
      'go-test',
    );
    expect(goResult.summary.total).toBe(1);
    expect(goResult.summary.duration_ms).toBe(12000);
    expect(
      __testOutputInternals.parseGoJson(`{"Action":"run","Test":"NoAction"}`, 'go-test').summary
        .total,
    ).toBe(0);

    const goFailure = __testOutputInternals.parseGoJson(
      `{"Action":"fail","Package":"pkg/example","Test":"TestOnly","Elapsed":0.02}`,
      'go-test',
    );
    expect(goFailure.failures).toEqual([
      expect.objectContaining({
        suite: 'pkg/example',
        message: 'TestOnly failed',
        stack_trace: 'TestOnly failed',
      }),
    ]);

    const goFailureWithoutElapsedOrStringPackage = __testOutputInternals.parseGoJson(
      `{"Action":"fail","Package":123,"Test":"TestNoElapsed"}`,
      'go-test',
    );
    expect(goFailureWithoutElapsedOrStringPackage.failures).toEqual([
      expect.objectContaining({
        suite: null,
        message: 'TestNoElapsed failed',
        stack_trace: 'TestNoElapsed failed',
      }),
    ]);
    expect(goFailureWithoutElapsedOrStringPackage.summary.duration_ms).toBe(0);

    const tapResult = __testOutputInternals.parseTap('ok 1', 'tap');
    expect(tapResult.summary.passed).toBe(1);

    const junitResult = __testOutputInternals.parseJunitXml(
      `<testsuite><testcase><failure>bad</failure></testcase></testsuite>`,
      'phpunit',
    );
    expect(junitResult.failures[0]).toMatchObject({ test_id: 'unknown-test', line_number: null });
    expect(
      __testOutputInternals.parseJunitXml('<testsuite></testsuite>', 'phpunit').summary.total,
    ).toBe(0);

    const merged = __testOutputInternals.mergeParsedResults(
      [
        {
          summary: {
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            errored: 0,
            duration_ms: 1,
            timestamp: '2024-01-01T00:00:00.000Z',
            runner_id: 'a',
          },
          failures: [],
          warnings: [],
          errors: [],
        },
        {
          summary: {
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            errored: 0,
            duration_ms: 1,
            timestamp: '2025-01-01T00:00:00.000Z',
            runner_id: 'b',
          },
          failures: [],
          warnings: [],
          errors: [],
        },
      ],
      'merged',
    );
    expect(merged.summary.timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  it('covers degraded single-source fallback and merge/finalize branches', () => {
    const weirdSource = {
      replace() {
        return this;
      },
      trim() {
        return this;
      },
      split() {
        throw new Error('broken split');
      },
      toString() {
        return '{';
      },
    } as unknown as string;

    const degraded = __testOutputInternals.parseSingleSource(
      weirdSource,
      { runner_id: 'jest', structured_format: 'jest-json' },
      [],
    );
    expect(degraded.strategy).toBe('degraded');

    const merged = __testOutputInternals.mergeParsedResults(
      [
        {
          summary: {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            errored: 0,
            duration_ms: 0,
            timestamp: '1970-01-01T00:00:00.000Z',
            runner_id: 'a',
          },
          failures: [],
          warnings: [],
          errors: [],
        },
        {
          summary: {
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            errored: 0,
            duration_ms: 1,
            timestamp: '2024-01-01T00:00:00.000Z',
            runner_id: 'b',
          },
          failures: [],
          warnings: [{ type: 'warning', message: 'dup', source_test_id: null }],
          errors: [],
        },
      ],
      'merged',
    );
    expect(merged.summary.timestamp).toBe('2024-01-01T00:00:00.000Z');

    const finalized = __testOutputInternals.finalizeParsedResult(
      {
        summary: {
          total: 0,
          passed: 1,
          failed: 1,
          skipped: 0,
          errored: 0,
          duration_ms: 1,
          timestamp: '1970-01-01T00:00:00.000Z',
          runner_id: 'merged',
        },
        failures: [],
        warnings: [],
        errors: [],
      },
      {
        raw_byte_size: 0,
        structured_byte_size: 0,
        compression_ratio: 0,
        original_size: 0,
        compact_size: 0,
        reduction_ratio: 0,
        delta_mode_used: false,
        escalation_occurred: false,
        escalation_reason: null,
        delta_summary: null,
        parse_strategy: 'structured',
        parse_warnings: [],
      },
    );
    expect(finalized.summary.total).toBe(2);
    expect(finalized.parse_metadata.compression_ratio).toBe(0);
    expect(__testOutputInternals.createEmptyParsedResult('x').summary.runner_id).toBe('x');
    expect(
      __testOutputInternals.createIssue({
        testId: 'x',
        suite: null,
        message: '  trimmed  ',
        stackTrace: ' stack ',
        filePath: null,
        lineNumber: null,
        category: 'unknown',
        durationMs: null,
      }),
    ).toEqual(
      expect.objectContaining({
        message: 'trimmed',
        stack_trace: 'stack',
      }),
    );
    expect(
      __testOutputInternals.createIssue({
        testId: 'blank',
        suite: null,
        message: '   ',
        stackTrace: '   ',
        filePath: null,
        lineNumber: null,
        category: 'unknown',
        durationMs: null,
      }),
    ).toEqual(
      expect.objectContaining({
        message: 'Unknown test issue',
        stack_trace: null,
      }),
    );
  });

  it('returns an empty attribute map when xml has no testcase opening tag', () => {
    expect(
      __testOutputInternals.parseXmlAttributes('<failure message="no testcase tag" />'),
    ).toEqual({});
  });

  it('covers plain-text total fallback when no summary counters are present', () => {
    const result = __testOutputInternals.parsePlainTextFallback('FAIL broke\nERROR boom', 'plain');
    expect(result.summary.total).toBe(2);
    expect(result.summary.duration_ms).toBe(0);
  });

  it('preserves plain-text failure messages when stack frames are appended', () => {
    const result = __testOutputInternals.parsePlainTextFallback(
      'FAIL expected true to be false\n  at file.test.ts:10:2\n  at runner.js:1:1',
      'plain',
    );
    expect(result.failures).toEqual([
      expect.objectContaining({
        message: 'expected true to be false',
        stack_trace: 'expected true to be false\nat file.test.ts:10:2\nat runner.js:1:1',
      }),
    ]);
  });

  it('does not double-count skipped tests in Jest when numPendingTests is set', () => {
    const result = __testOutputInternals.parseJestJson(
      JSON.stringify({
        numTotalTests: 3,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 1,
        testResults: [
          {
            name: 'suite.test.ts',
            assertionResults: [
              { fullName: 'a passes', status: 'passed', failureMessages: [] },
              { fullName: 'b fails', status: 'failed', failureMessages: ['Expected 1 to be 2'] },
              { fullName: 'c skips', status: 'pending', failureMessages: [] },
            ],
          },
        ],
      }),
      'jest',
    );
    expect(result.summary.skipped).toBe(1);
  });

  it('parses valid Go JSON lines and skips malformed ones with a warning', () => {
    const warnings: string[] = [];
    const result = __testOutputInternals.parseGoJson(
      `{"Action":"pass","Test":"TestA","Elapsed":0.01}\nNOT JSON\n{"Action":"pass","Test":"TestB","Elapsed":0.02}`,
      'go-test',
      warnings,
    );
    expect(result.summary.total).toBe(2);
    expect(result.summary.passed).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('skipped malformed line');
  });

  it('parses JUnit XML with self-closing testcase tags', () => {
    const result = __testOutputInternals.parseJunitXml(
      `<testsuite tests="2">
  <testcase classname="MathTest" name="adds" time="0.01"/>
  <testcase classname="MathTest" name="divides" time="0.02">
    <failure message="Expected 4 to equal 5">stack trace here</failure>
  </testcase>
</testsuite>`,
      'phpunit',
    );
    expect(result.summary.total).toBe(2);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.passed).toBe(1);
    expect(result.failures[0]?.test_id).toBe('MathTest::divides');
  });

  it('converts JUnit XML time string attributes to milliseconds', () => {
    const result = __testOutputInternals.parseJunitXml(
      `<testsuite><testcase classname="A" name="b" time="0.5"></testcase></testsuite>`,
      'phpunit',
    );
    expect(result.summary.duration_ms).toBe(500);
  });

  it('counts self-closing skipped JUnit cases as skipped instead of passed', () => {
    const result = __testOutputInternals.parseJunitXml(
      `<testsuite tests="2">
  <testcase classname="MathTest" name="adds"><skipped /></testcase>
  <testcase classname="MathTest" name="subtracts"></testcase>
</testsuite>`,
      'phpunit',
    );
    expect(result.summary.total).toBe(2);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.passed).toBe(1);
  });
});
