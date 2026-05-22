import { readFile } from 'node:fs/promises';

import fg from 'fast-glob';

import type {
  StackPackTestRunner,
  StructuredTestIssue,
  StructuredTestParseMetadata,
  StructuredTestResult,
  StructuredTestWarning,
  TestIssueCategory,
  TestParseStrategy,
} from '@/core/types/index.js';
import { TEST_OUTPUT_SCHEMA_VERSION, UNKNOWN_TEST_OUTPUT_TIMESTAMP } from '@/core/types/index.js';
import {
  buildCompactArtifact,
  buildReasoningInputPayload,
  createTestDelta,
  evaluateEscalation,
} from '@/token-efficiency/index.js';

interface MutableParsedResult {
  summary: StructuredTestResult['summary'];
  failures: StructuredTestIssue[];
  warnings: StructuredTestWarning[];
  errors: StructuredTestIssue[];
}

export interface ParseTestOutputOptions {
  runner: StackPackTestRunner;
  cwd?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  baseline_result?: StructuredTestResult;
  include_full_issues_with_baseline?: boolean;
}

export async function parseTestOutput(
  options: ParseTestOutputOptions,
): Promise<StructuredTestResult> {
  const rawSources = await collectRawSources(options);
  const parseWarnings: string[] = [];

  if (rawSources.length === 0) {
    parseWarnings.push(`No test output found for runner "${options.runner.runner_id}"`);
    const compact = buildCompactArtifact({
      artifact_class: 'test-output',
      raw_content: '',
      max_excerpts: 0,
    });
    const tokenPayload = buildReasoningInputPayload(
      compact,
      evaluateEscalation({
        compact,
        reason: 'structured-parse-failed-or-degraded',
      }),
    );
    return finalizeParsedResult(createEmptyParsedResult(options.runner.runner_id), {
      raw_byte_size: 0,
      structured_byte_size: 0,
      compression_ratio: 0,
      original_size: tokenPayload.metadata.original_size,
      compact_size: tokenPayload.metadata.compact_size,
      reduction_ratio: tokenPayload.metadata.reduction_ratio,
      delta_mode_used: options.baseline_result !== undefined,
      escalation_occurred: tokenPayload.metadata.escalation_occurred,
      escalation_reason: tokenPayload.escalation_reason,
      delta_summary: options.baseline_result
        ? summarizeTestDelta(
            options.baseline_result,
            createEmptyParsedResult(options.runner.runner_id),
          )
        : null,
      parse_strategy: 'degraded',
      parse_warnings: parseWarnings,
    });
  }

  const parsedResults: MutableParsedResult[] = [];
  let parseStrategy: TestParseStrategy =
    options.runner.structured_format === 'none' ? 'plain-text-fallback' : 'structured';
  let rawByteSize = 0;

  for (const source of rawSources) {
    rawByteSize += Buffer.byteLength(source, 'utf8');
    const parsed = parseSingleSource(source, options.runner, parseWarnings);
    parsedResults.push(parsed.result);
    parseStrategy = selectDominantStrategy(parseStrategy, parsed.strategy);
  }

  const compact = buildCompactArtifact({
    artifact_class: 'test-output',
    raw_content: rawSources.join('\n'),
  });
  const shouldEscalateForParseHealth =
    parseStrategy === 'degraded' ||
    parseWarnings.some((warning) => warning.startsWith('Structured parser'));
  const tokenPayload = buildReasoningInputPayload(
    compact,
    evaluateEscalation(
      shouldEscalateForParseHealth
        ? {
            compact,
            reason: 'structured-parse-failed-or-degraded',
          }
        : { compact },
    ),
  );

  const merged = mergeParsedResults(parsedResults, options.runner.runner_id);
  const projected =
    options.baseline_result && options.include_full_issues_with_baseline !== true
      ? projectDeltaIssues(options.baseline_result, merged)
      : merged;

  return finalizeParsedResult(projected, {
    raw_byte_size: rawByteSize,
    structured_byte_size: 0,
    compression_ratio: 0,
    original_size: tokenPayload.metadata.original_size,
    compact_size: tokenPayload.metadata.compact_size,
    reduction_ratio: tokenPayload.metadata.reduction_ratio,
    delta_mode_used: options.baseline_result !== undefined,
    escalation_occurred: tokenPayload.metadata.escalation_occurred,
    escalation_reason: tokenPayload.escalation_reason,
    delta_summary: options.baseline_result
      ? summarizeTestDelta(options.baseline_result, merged)
      : null,
    parse_strategy: parseStrategy,
    parse_warnings: dedupeStrings(parseWarnings),
  });
}

function parseSingleSource(
  rawSource: string,
  runner: StackPackTestRunner,
  parseWarnings: string[],
): { result: MutableParsedResult; strategy: TestParseStrategy } {
  const normalized = normalizeRawOutput(rawSource);

  if (runner.structured_format !== 'none') {
    try {
      return {
        result: parseStructuredByFormat(normalized, runner, parseWarnings),
        strategy: 'structured',
      };
    } catch (error) {
      parseWarnings.push(
        `Structured parser for "${runner.runner_id}" failed: ${formatErrorMessage(error)}`,
      );
    }
  }

  try {
    return {
      result: parsePlainTextFallback(normalized, runner.runner_id),
      strategy: 'plain-text-fallback',
    };
  } catch (error) {
    parseWarnings.push(
      `Plain-text fallback for "${runner.runner_id}" failed: ${formatErrorMessage(error)}`,
    );
    return {
      result: createEmptyParsedResult(runner.runner_id),
      strategy: 'degraded',
    };
  }
}

async function collectRawSources(options: ParseTestOutputOptions): Promise<string[]> {
  if ((options.runner.output_source ?? 'stdout') === 'file') {
    if (!options.runner.output_path_pattern) {
      return [];
    }

    const matches = await fg(options.runner.output_path_pattern, {
      cwd: options.cwd,
      absolute: true,
      onlyFiles: true,
    });
    const sortedMatches = [...matches].sort((left, right) => left.localeCompare(right));

    return Promise.all(sortedMatches.map((path) => readFile(path, 'utf8')));
  }

  const stdout = toUtf8String(options.stdout);
  const stderr = toUtf8String(options.stderr);
  const combined = [stdout, stderr].filter((value) => value.trim().length > 0).join('\n');
  return combined.trim().length > 0 ? [combined] : [];
}

function parseStructuredByFormat(
  rawOutput: string,
  runner: StackPackTestRunner,
  parseWarnings: string[] = [],
): MutableParsedResult {
  switch (runner.structured_format) {
    case 'jest-json':
      return parseJestJson(rawOutput, runner.runner_id);
    case 'junit-xml':
      return parseJunitXml(rawOutput, runner.runner_id);
    case 'pytest-json':
      return parsePytestJson(rawOutput, runner.runner_id);
    case 'go-json':
      return parseGoJson(rawOutput, runner.runner_id, parseWarnings);
    case 'rspec-json':
      return parseRspecJson(rawOutput, runner.runner_id);
    case 'tap':
      return parseTap(rawOutput, runner.runner_id);
  }

  throw new Error(`Unsupported structured format "${runner.structured_format}"`);
}

function parseJestJson(rawOutput: string, runnerId: string): MutableParsedResult {
  const parsed = JSON.parse(rawOutput) as {
    success?: boolean;
    startTime?: number;
    numTotalTests?: number;
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    testResults?: Array<{
      name?: string;
      assertionResults?: Array<{
        ancestorTitles?: string[];
        title?: string;
        fullName?: string;
        status?: string;
        failureMessages?: string[];
        location?: { line?: number } | null;
        duration?: number | null;
      }>;
    }>;
  };

  const failures: StructuredTestIssue[] = [];
  const errors: StructuredTestIssue[] = [];
  let skippedFromLoop = 0;

  for (const suite of parsed.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      const testId =
        assertion.fullName ||
        [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(' ') ||
        suite.name ||
        'unknown-test';
      const issue = createIssue({
        testId,
        suite: assertion.ancestorTitles?.join(' > ') || null,
        message: assertion.failureMessages?.join('\n\n') || `Test ${assertion.status ?? 'unknown'}`,
        stackTrace: assertion.failureMessages?.join('\n\n') || null,
        filePath: suite.name ?? null,
        lineNumber: assertion.location?.line ?? null,
        category: classifyIssue(assertion.failureMessages?.join('\n') ?? '', 'assertion'),
        durationMs: assertion.duration ?? null,
      });

      if (assertion.status === 'failed') {
        failures.push(issue);
      } else if (assertion.status === 'pending' || assertion.status === 'skipped') {
        skippedFromLoop += 1;
      }
    }
  }

  // Prefer the authoritative Jest summary count; fall back to the loop count only when absent.
  const failed = parsed.numFailedTests ?? failures.length;
  const skipped = parsed.numPendingTests ?? skippedFromLoop;

  return {
    summary: {
      total:
        parsed.numTotalTests ?? (parsed.numPassedTests ?? 0) + failed + skipped + errors.length,
      passed: parsed.numPassedTests ?? 0,
      failed,
      skipped,
      errored: errors.length,
      duration_ms: 0,
      timestamp: toIsoTimestamp(parsed.startTime),
      runner_id: runnerId,
    },
    failures,
    warnings: [],
    errors,
  };
}

function parsePytestJson(rawOutput: string, runnerId: string): MutableParsedResult {
  const parsed = JSON.parse(rawOutput) as {
    created?: string;
    duration?: number;
    summary?: Partial<Record<'total' | 'passed' | 'failed' | 'skipped' | 'error', number>>;
    tests?: Array<{
      nodeid?: string;
      outcome?: string;
      keywords?: string[];
      lineno?: number;
      call?: {
        crash?: { message?: string; path?: string; lineno?: number };
        longrepr?: string;
        duration?: number;
      };
    }>;
  };

  const failures: StructuredTestIssue[] = [];
  const errors: StructuredTestIssue[] = [];

  for (const test of parsed.tests ?? []) {
    const detail = test.call?.longrepr ?? test.call?.crash?.message ?? test.outcome ?? 'unknown';
    const issue = createIssue({
      testId: test.nodeid ?? 'unknown-test',
      suite: test.nodeid?.split('::').slice(0, -1).join('::') || null,
      message: detail,
      stackTrace: test.call?.longrepr ?? null,
      filePath: test.call?.crash?.path ?? test.nodeid?.split('::')[0] ?? null,
      lineNumber: test.call?.crash?.lineno ?? test.lineno ?? null,
      category: classifyIssue(detail, test.outcome === 'error' ? 'error' : 'assertion'),
      durationMs: toMilliseconds(test.call?.duration),
    });

    if (test.outcome === 'failed') failures.push(issue);
    if (test.outcome === 'error') errors.push(issue);
  }

  return {
    summary: {
      total: parsed.summary?.total ?? parsed.tests?.length ?? 0,
      passed: parsed.summary?.passed ?? 0,
      failed: parsed.summary?.failed ?? failures.length,
      skipped: parsed.summary?.skipped ?? 0,
      errored: parsed.summary?.error ?? errors.length,
      duration_ms: toMilliseconds(parsed.duration) ?? 0,
      timestamp: normalizeTimestamp(parsed.created),
      runner_id: runnerId,
    },
    failures,
    warnings: [],
    errors,
  };
}

function parseRspecJson(rawOutput: string, runnerId: string): MutableParsedResult {
  const parsed = JSON.parse(rawOutput) as {
    summary?: {
      example_count?: number;
      failure_count?: number;
      pending_count?: number;
      duration?: number;
    };
    examples?: Array<{
      id?: string;
      full_description?: string;
      status?: string;
      file_path?: string;
      line_number?: number;
      run_time?: number;
      exception?: {
        message?: string;
        backtrace?: string[];
      };
    }>;
  };

  const failures: StructuredTestIssue[] = [];
  const errors: StructuredTestIssue[] = [];

  for (const example of parsed.examples ?? []) {
    if (example.status !== 'failed') continue;
    const message = example.exception?.message ?? 'RSpec example failed';
    failures.push(
      createIssue({
        testId: example.full_description ?? example.id ?? 'unknown-test',
        suite: null,
        message,
        stackTrace: example.exception?.backtrace?.join('\n') ?? null,
        filePath: example.file_path ?? null,
        lineNumber: example.line_number ?? null,
        category: classifyIssue(message, 'assertion'),
        durationMs: toMilliseconds(example.run_time),
      }),
    );
  }

  return {
    summary: {
      total: parsed.summary?.example_count ?? parsed.examples?.length ?? 0,
      passed:
        (parsed.summary?.example_count ?? 0) -
        (parsed.summary?.failure_count ?? failures.length) -
        (parsed.summary?.pending_count ?? 0),
      failed: parsed.summary?.failure_count ?? failures.length,
      skipped: parsed.summary?.pending_count ?? 0,
      errored: errors.length,
      duration_ms: toMilliseconds(parsed.summary?.duration) ?? 0,
      timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
      runner_id: runnerId,
    },
    failures,
    warnings: [],
    errors,
  };
}

function parseGoJson(
  rawOutput: string,
  runnerId: string,
  parseWarnings: string[] = [],
): MutableParsedResult {
  const lines = rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      parseWarnings.push(`Go JSON: skipped malformed line: ${line.slice(0, 100)}`);
    }
  }
  const outputs = new Map<string, string[]>();
  const failures: StructuredTestIssue[] = [];
  const errors: StructuredTestIssue[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  let durationMs = 0;

  for (const event of events) {
    const testId = typeof event.Test === 'string' ? event.Test : null;
    const action = typeof event.Action === 'string' ? event.Action : null;
    const output = typeof event.Output === 'string' ? event.Output : null;

    if (testId && output) {
      outputs.set(testId, [...(outputs.get(testId) ?? []), output.trimEnd()]);
    }

    if (!testId || !action) continue;

    if (action === 'pass' || action === 'fail' || action === 'skip') {
      total += 1;
      durationMs += toMilliseconds(event.Elapsed) ?? 0;
      if (action === 'pass') passed += 1;
      if (action === 'skip') skipped += 1;
      if (action === 'fail') {
        failed += 1;
        const message = (outputs.get(testId) ?? []).join('\n').trim() || `${testId} failed`;
        failures.push(
          createIssue({
            testId,
            suite: typeof event.Package === 'string' ? event.Package : null,
            message,
            stackTrace: message,
            filePath: null,
            lineNumber: null,
            category: classifyIssue(message, 'assertion'),
            durationMs: toMilliseconds(event.Elapsed),
          }),
        );
      }
    }
  }

  return {
    summary: {
      total,
      passed,
      failed,
      skipped,
      errored: errors.length,
      duration_ms: durationMs,
      timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
      runner_id: runnerId,
    },
    failures,
    warnings: [],
    errors,
  };
}

function parseTap(rawOutput: string, runnerId: string): MutableParsedResult {
  const failures: StructuredTestIssue[] = [];
  const warnings: StructuredTestWarning[] = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let currentFailure: StructuredTestIssue | null = null;

  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trimEnd();
    const okMatch = /^(not )?ok\b(?:\s+\d+)?(?:\s+-\s+)?(.+)?$/i.exec(trimmed);

    if (okMatch) {
      total += 1;
      const isFailure = okMatch[1] === 'not ';
      const description = okMatch[2]?.trim() || `test-${total}`;
      const isSkipped = /#\s*skip/i.test(trimmed);

      if (isSkipped) {
        skipped += 1;
        currentFailure = null;
        continue;
      }

      if (isFailure) {
        failed += 1;
        currentFailure = createIssue({
          testId: description,
          suite: null,
          message: description,
          stackTrace: null,
          filePath: null,
          lineNumber: null,
          category: 'unknown',
          durationMs: null,
        });
        failures.push(currentFailure);
      } else {
        passed += 1;
        currentFailure = null;
      }
      continue;
    }

    if (trimmed.startsWith('#') && currentFailure !== null) {
      currentFailure.message = `${currentFailure.message}\n${trimmed.slice(1).trim()}`.trim();
      currentFailure.stack_trace = currentFailure.message;
      currentFailure.category = classifyIssue(currentFailure.message, 'assertion');
      continue;
    }

    if (trimmed.startsWith('#') && currentFailure === null) {
      warnings.push({
        type: 'tap-note',
        message: trimmed.slice(1).trim(),
        source_test_id: null,
      });
    }
  }

  return {
    summary: {
      total,
      passed,
      failed,
      skipped,
      errored: 0,
      duration_ms: 0,
      timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
      runner_id: runnerId,
    },
    failures,
    warnings,
    errors: [],
  };
}

function parseJunitXml(rawOutput: string, runnerId: string): MutableParsedResult {
  if (!rawOutput.includes('<testsuite') && !rawOutput.includes('<testcase')) {
    throw new Error('Not valid JUnit XML');
  }

  const failures: StructuredTestIssue[] = [];
  const errors: StructuredTestIssue[] = [];
  const warnings: StructuredTestWarning[] = [];
  const cases = rawOutput.match(/<testcase\b(?:[^>]*\/>|[\s\S]*?<\/testcase>)/g) ?? [];
  let total = 0;
  let failed = 0;
  let skipped = 0;
  let errored = 0;
  let durationMs = 0;

  for (const testCase of cases) {
    total += 1;
    const attrs = parseXmlAttributes(testCase);
    durationMs += toMilliseconds(attrs.time) ?? 0;
    const failureTag = extractTag(testCase, 'failure');
    const errorTag = extractTag(testCase, 'error');
    const skippedTag = extractTag(testCase, 'skipped');
    const systemErr = extractTag(testCase, 'system-err');
    const testId = [attrs.classname, attrs.name].filter(Boolean).join('::') || 'unknown-test';

    if (skippedTag) {
      skipped += 1;
      continue;
    }

    if (failureTag) {
      failed += 1;
      failures.push(
        createIssue({
          testId,
          suite: attrs.classname ?? null,
          message: (failureTag.message ?? failureTag.content) || 'Test failed',
          stackTrace: failureTag.content || null,
          filePath: attrs.file ?? null,
          lineNumber: toInteger(attrs.line),
          // `extractTag()` always returns a string `content`, so `?? ''` is unreachable here.
          category: classifyIssue(failureTag.message ?? failureTag.content, 'assertion'),
          durationMs: toMilliseconds(attrs.time),
        }),
      );
      continue;
    }

    if (errorTag) {
      errored += 1;
      errors.push(
        createIssue({
          testId,
          suite: attrs.classname ?? null,
          message: (errorTag.message ?? errorTag.content) || 'Test errored',
          stackTrace: errorTag.content || null,
          filePath: attrs.file ?? null,
          lineNumber: toInteger(attrs.line),
          // `extractTag()` always returns a string `content`, so `?? ''` is unreachable here.
          category: classifyIssue(errorTag.message ?? errorTag.content, 'error'),
          durationMs: toMilliseconds(attrs.time),
        }),
      );
      continue;
    }

    if (systemErr) {
      warnings.push({
        type: 'runner-stderr',
        message: systemErr.content,
        source_test_id: testId,
      });
    }
  }

  return {
    summary: {
      total,
      passed: total - failed - skipped - errored,
      failed,
      skipped,
      errored,
      duration_ms: durationMs,
      timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
      runner_id: runnerId,
    },
    failures,
    warnings,
    errors,
  };
}

function parsePlainTextFallback(rawOutput: string, runnerId: string): MutableParsedResult {
  const lines = rawOutput
    .split('\n')
    .map((line) => line.replace(/\r/g, ''))
    .filter((line) => !isRunnerEnvelope(line));
  const failures: StructuredTestIssue[] = [];
  const errors: StructuredTestIssue[] = [];
  const warnings: StructuredTestWarning[] = [];
  let currentIssue: StructuredTestIssue | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/warning|deprecated|deprecation/i.test(trimmed)) {
      warnings.push({ type: 'warning', message: trimmed, source_test_id: null });
    }

    const failureMatch =
      /^(?:FAIL(?:ED)?|not ok|✕|x)\s*[:-]?\s*(.+)$/i.exec(trimmed) ??
      /^\s*\d+\)\s+(.+)$/.exec(trimmed);
    if (failureMatch) {
      currentIssue = createIssue({
        testId: failureMatch[1].trim(),
        suite: null,
        message: failureMatch[1].trim(),
        stackTrace: null,
        filePath: null,
        lineNumber: null,
        category: 'unknown',
        durationMs: null,
      });
      failures.push(currentIssue);
      continue;
    }

    const errorMatch = /^ERROR\s*[:-]?\s*(.+)$/i.exec(trimmed);
    if (errorMatch) {
      currentIssue = createIssue({
        testId: errorMatch[1].trim(),
        suite: null,
        message: errorMatch[1].trim(),
        stackTrace: null,
        filePath: null,
        lineNumber: null,
        category: 'error',
        durationMs: null,
      });
      errors.push(currentIssue);
      continue;
    }

    if (currentIssue !== null && (line.startsWith(' ') || /^\s*at\s+/.test(line))) {
      currentIssue.stack_trace = `${currentIssue.stack_trace ?? currentIssue.message}\n${trimmed}`;
      currentIssue.category = classifyIssue(currentIssue.stack_trace, currentIssue.category);
      continue;
    }
  }

  const failed = failures.length;
  const errored = errors.length;
  const passed = extractSummaryCount(lines, 'passed');
  const skipped = extractSummaryCount(lines, 'skipped');
  const total =
    extractSummaryCount(lines, 'total') ||
    extractSummaryCount(lines, 'tests') ||
    passed + failed + errored + skipped;

  return {
    summary: {
      total,
      passed,
      failed,
      skipped,
      errored,
      duration_ms: extractDurationMs(lines) ?? 0,
      timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
      runner_id: runnerId,
    },
    failures,
    warnings: dedupeWarnings(warnings),
    errors,
  };
}

function mergeParsedResults(results: MutableParsedResult[], runnerId: string): MutableParsedResult {
  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
    duration_ms: 0,
    timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
    runner_id: runnerId,
  };
  const failures: StructuredTestIssue[] = [];
  const warnings: StructuredTestWarning[] = [];
  const errors: StructuredTestIssue[] = [];

  for (const result of results) {
    summary.total += result.summary.total;
    summary.passed += result.summary.passed;
    summary.failed += result.summary.failed;
    summary.skipped += result.summary.skipped;
    summary.errored += result.summary.errored;
    summary.duration_ms += result.summary.duration_ms;
    summary.timestamp =
      summary.timestamp === UNKNOWN_TEST_OUTPUT_TIMESTAMP
        ? result.summary.timestamp
        : summary.timestamp;
    failures.push(...result.failures);
    warnings.push(...result.warnings);
    errors.push(...result.errors);
  }

  return {
    summary,
    failures,
    warnings: dedupeWarnings(warnings),
    errors,
  };
}

function finalizeParsedResult(
  result: MutableParsedResult,
  parseMetadata: StructuredTestParseMetadata,
): StructuredTestResult {
  const structured: StructuredTestResult = {
    schema_version: TEST_OUTPUT_SCHEMA_VERSION,
    summary: {
      ...result.summary,
      total:
        result.summary.total ||
        result.summary.passed +
          result.summary.failed +
          result.summary.skipped +
          result.summary.errored,
    },
    failures: result.failures,
    warnings: result.warnings,
    parse_metadata: parseMetadata,
    errors: result.errors,
  };
  const structuredByteSize = Buffer.byteLength(JSON.stringify(structured), 'utf8');
  const rawByteSize = parseMetadata.raw_byte_size;

  structured.parse_metadata.structured_byte_size = structuredByteSize;
  structured.parse_metadata.compression_ratio =
    rawByteSize > 0 ? Math.max(0, 1 - structuredByteSize / rawByteSize) : 0;
  return structured;
}

function createEmptyParsedResult(runnerId: string): MutableParsedResult {
  return {
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errored: 0,
      duration_ms: 0,
      timestamp: UNKNOWN_TEST_OUTPUT_TIMESTAMP,
      runner_id: runnerId,
    },
    failures: [],
    warnings: [],
    errors: [],
  };
}

function summarizeTestDelta(
  baseline: StructuredTestResult,
  current: MutableParsedResult,
): StructuredTestParseMetadata['delta_summary'] {
  const baselineIssues = toIssueSnapshots(baseline.failures, baseline.errors);
  const currentIssues = toIssueSnapshots(current.failures, current.errors);
  const { delta } = createTestDelta(baselineIssues, currentIssues, {
    treat_missing_as_passing: true,
  });

  return {
    newly_failing_tests: delta.newly_failing_tests.length,
    newly_passing_tests: delta.newly_passing_tests.length,
    newly_errored_tests: delta.newly_errored_tests.length,
    changed_failure_messages: delta.changed_failure_messages.length,
  };
}

function projectDeltaIssues(
  baseline: StructuredTestResult,
  current: MutableParsedResult,
): MutableParsedResult {
  const baselineIssues = toIssueSnapshots(baseline.failures, baseline.errors);
  const currentIssues = toIssueSnapshots(current.failures, current.errors);
  const { delta } = createTestDelta(baselineIssues, currentIssues, {
    treat_missing_as_passing: true,
  });
  const includeIds = new Set<string>([
    ...delta.newly_failing_tests,
    ...delta.newly_errored_tests,
    ...delta.changed_failure_messages.map((entry) => entry.test_id),
  ]);

  return {
    summary: current.summary,
    failures: current.failures.filter((issue) => includeIds.has(issue.test_id)),
    warnings: current.warnings.filter(
      (warning) => warning.source_test_id !== null && includeIds.has(warning.source_test_id),
    ),
    errors: current.errors.filter((issue) => includeIds.has(issue.test_id)),
  };
}

function toIssueSnapshots(
  failures: StructuredTestIssue[],
  errors: StructuredTestIssue[],
): Array<{ test_id: string; message: string; status: 'passed' | 'failed' | 'errored' }> {
  return [
    ...failures.map((issue) => ({
      test_id: issue.test_id,
      message: issue.message,
      status: 'failed' as const,
    })),
    ...errors.map((issue) => ({
      test_id: issue.test_id,
      message: issue.message,
      status: 'errored' as const,
    })),
  ];
}

function createIssue(input: {
  testId: string;
  suite: string | null;
  message: string;
  stackTrace: string | null;
  filePath: string | null;
  lineNumber: number | null;
  category: TestIssueCategory;
  durationMs: number | null;
}): StructuredTestIssue {
  return {
    test_id: input.testId,
    suite: input.suite,
    message: input.message.trim() || 'Unknown test issue',
    stack_trace: input.stackTrace?.trim() || null,
    file_path: input.filePath,
    line_number: input.lineNumber,
    category: input.category,
    duration_ms: input.durationMs,
  };
}

function classifyIssue(message: string, fallback: TestIssueCategory): TestIssueCategory {
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/error|exception|panic|segmentation fault/i.test(message)) return 'error';
  if (/expected|assert|failure|mismatch/i.test(message)) return 'assertion';
  return fallback;
}

function normalizeRawOutput(rawOutput: string): string {
  const ansiPattern = new RegExp(
    String.raw`\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])`,
    'g',
  );
  return rawOutput.replace(ansiPattern, '').replace(/\r/g, '').trim();
}

function extractSummaryCount(lines: string[], label: string): number {
  const patterns = [
    new RegExp(`\\b${label}\\b[^\\d]*(\\d+)`, 'i'),
    new RegExp(`(\\d+)[^\\n]*\\b${label}\\b`, 'i'),
  ];

  for (const line of [...lines].reverse()) {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match) {
        return Number(match[1]);
      }
    }
  }

  return 0;
}

function extractDurationMs(lines: string[]): number | null {
  const candidates = [...lines].reverse();
  for (const line of candidates) {
    const seconds = /(\d+(?:\.\d+)?)s\b/.exec(line);
    if (seconds) return Number(seconds[1]) * 1000;
    const milliseconds = /(\d+(?:\.\d+)?)ms\b/.exec(line);
    if (milliseconds) return Number(milliseconds[1]);
  }
  return null;
}

function isRunnerEnvelope(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    /^[-=.]{3,}$/.test(trimmed) ||
    /^Ran \d+ tests? in /i.test(trimmed) ||
    /^={2,}\s*coverage/i.test(trimmed) ||
    /^%?\s*Statements\s*:/.test(trimmed) ||
    /^\.+$/.test(trimmed)
  );
}

function parseXmlAttributes(xmlFragment: string): Record<string, string> {
  const attrMatch = /<testcase\b([^>]*)>/i.exec(xmlFragment);
  const rawAttrs = attrMatch?.[1] ?? '';
  const attrs: Record<string, string> = {};
  for (const match of rawAttrs.matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

function extractTag(
  xmlFragment: string,
  tagName: string,
): { message: string | null; content: string } | null {
  const pairedMatch = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(
    xmlFragment,
  );
  const selfClosingMatch = new RegExp(`<${tagName}\\b([^>]*)\\/\\s*>`, 'i').exec(xmlFragment);
  const match = pairedMatch ?? selfClosingMatch;
  if (!match) return null;
  const attrs: Record<string, string> = {};
  for (const attr of match[1].matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[attr[1]] = decodeXmlEntities(attr[2]);
  }
  return {
    message: attrs.message ?? null,
    content: decodeXmlEntities((pairedMatch?.[2] ?? '').trim()),
  };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function toUtf8String(value: string | Buffer | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : value.toString('utf8');
}

function toMilliseconds(value: unknown): number | null {
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n * 1000;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value * 1000;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function toIsoTimestamp(epochMs: number | undefined): string {
  return typeof epochMs === 'number' && Number.isFinite(epochMs)
    ? new Date(epochMs).toISOString()
    : UNKNOWN_TEST_OUTPUT_TIMESTAMP;
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) return UNKNOWN_TEST_OUTPUT_TIMESTAMP;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? UNKNOWN_TEST_OUTPUT_TIMESTAMP : parsed.toISOString();
}

function dedupeWarnings(warnings: StructuredTestWarning[]): StructuredTestWarning[] {
  const seen = new Set<string>();
  const deduped: StructuredTestWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.type}:${warning.message}:${warning.source_test_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectDominantStrategy(
  current: TestParseStrategy,
  next: TestParseStrategy,
): TestParseStrategy {
  const rank = {
    structured: 0,
    'plain-text-fallback': 1,
    degraded: 2,
  } as const;

  return rank[next] > rank[current] ? next : current;
}

export const __testOutputInternals = {
  selectDominantStrategy,
  parseSingleSource,
  collectRawSources,
  parseStructuredByFormat,
  parseJestJson,
  parsePytestJson,
  parseRspecJson,
  parseGoJson,
  parseTap,
  parseJunitXml,
  parsePlainTextFallback,
  mergeParsedResults,
  finalizeParsedResult,
  createEmptyParsedResult,
  summarizeTestDelta,
  projectDeltaIssues,
  createIssue,
  classifyIssue,
  normalizeRawOutput,
  extractSummaryCount,
  extractDurationMs,
  isRunnerEnvelope,
  parseXmlAttributes,
  extractTag,
  decodeXmlEntities,
  toUtf8String,
  toMilliseconds,
  toInteger,
  toIsoTimestamp,
  normalizeTimestamp,
  dedupeWarnings,
  dedupeStrings,
  formatErrorMessage,
};
