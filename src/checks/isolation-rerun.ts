// The isolated re-run verdict (issue #554, Part D). After the parallel run, every failing test is
// re-run by itself. A test that fails any isolated re-run is real and blocks (INV-2); a test that
// passes every isolated re-run only failed in the crowd, so it is quarantined in the flaky registry
// and does not block (under the default `warn`/`pass` modes). The runner WRITES the registry for
// tracking; it never READS it to change a verdict (INV-3) — the isolated re-run is the only
// tie-breaker. Everything here is deterministic; the re-runs go through the injected shell.

import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

import { RERUN_MAX_FAILURE_RATIO, RERUN_MAX_FAILURES } from '@/checks/constants.js';
import { modulesForFile } from '@/flaky/attribution.js';
import { readFlakyRegistry, upsertQuarantine, writeFlakyRegistry } from '@/flaky/registry.js';
import { detectFlakinessSmells, smellCategories } from '@/flaky/smells.js';
import { judgeStability } from '@/flaky/stability.js';
import type { SingleTestSelector } from '@/core/types/pack.js';
import type { StructuredTestIssue, StructuredTestResult } from '@/core/types/test-output.js';

export type ChecksFlakyMode = 'pass' | 'warn' | 'fail';

/** One isolated-re-run row, as it appears in `checks.json.isolation_reruns.entries`. */
export interface IsolationRerunEntry {
  test_id: string;
  file_path: string | null;
  line_number: number | null;
  selector: string | null;
  attempts: number;
  passes: number;
  verdict: 'real' | 'recovered' | 'flaky';
  blocking: boolean;
  /** `no-selector` / `selector-matched-nothing`, when that is why it blocked. */
  reason?: string;
}

export interface FlakyUnderParallel {
  test_id: string;
  file_path: string | null;
  line_number: number | null;
  suspected_causes: string[];
}

/** The result of a single isolated re-run: the parsed result plus its exit code. */
export interface SingleRunOutcome {
  exitCode: number;
  result: StructuredTestResult;
}

export interface ConfirmFailuresInput {
  /** The parsed `test` result; a mutated COPY is returned (recovered removed, summary decremented). */
  result: StructuredTestResult;
  projectRoot: string;
  /** `commands.test_single`, carrying `<pattern>` / `<path_or_file>`. */
  singleCommandTemplate: string;
  singleSelector: SingleTestSelector;
  /** The runner's `output_path_pattern`, redirected per re-run so the main result is not overwritten. */
  outputPathPattern?: string;
  flakyMode: ChecksFlakyMode;
  /** `resolveRerunCount(projectRoot)`; how many isolated re-runs per failure. */
  rerunCount: number;
  now: () => string;
  /** Run one isolated test command and return its parsed result + exit code. */
  runSingle: (command: string) => Promise<SingleRunOutcome>;
  /** Injected for tests; defaults to reading the test file from disk. */
  readTestFile?: (absPath: string) => string | null;
}

export interface ConfirmFailuresOutput {
  result: StructuredTestResult;
  isolation_reruns: {
    performed: boolean;
    skipped_reason: string | null;
    rerun_count: number;
    entries: IsolationRerunEntry[];
  };
  flaky_under_parallel: FlakyUnderParallel[];
  meaningful_green: boolean;
}

interface Failing {
  issue: StructuredTestIssue;
  bucket: 'failures' | 'errors';
}

function collectFailing(result: StructuredTestResult): Failing[] {
  return [
    ...result.failures.map((issue) => ({ issue, bucket: 'failures' as const })),
    ...result.errors.map((issue) => ({ issue, bucket: 'errors' as const })),
  ];
}

/** `test_id` selector: the last `::` segment (a pytest node id) else the whole id; `file`: file_path. */
function buildSelector(issue: StructuredTestIssue, selector: SingleTestSelector): string {
  if (selector === 'file') return issue.file_path ?? '';
  const id = issue.test_id ?? '';
  return id.includes('::') ? (id.split('::').pop() ?? '') : id;
}

/** Substitute the selector and redirect the re-run output file so the main result is preserved. */
function buildRerunCommand(
  template: string,
  selector: string,
  outputPathPattern: string | undefined,
  index: number,
): string {
  let command = template.split('<pattern>').join(selector).split('<path_or_file>').join(selector);
  if (outputPathPattern && command.includes(outputPathPattern)) {
    const ext = extname(outputPathPattern).replace(/^\./, '') || 'out';
    command = command.split(outputPathPattern).join(`.paqad/test-results/rerun-${index}.${ext}`);
  }
  return command;
}

function readSource(
  projectRoot: string,
  filePath: string | null,
  read: (absPath: string) => string | null,
): string {
  if (!filePath) return '';
  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
  if (!abs.startsWith(resolve(projectRoot))) return '';
  return read(abs) ?? '';
}

function defaultReadTestFile(absPath: string): string | null {
  try {
    return existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
  } catch {
    /* v8 ignore next -- unreadable test file just yields no smells */
    return null;
  }
}

/**
 * Confirm every failure alone. Called only when the parsed `test` result has ≥ 1 failure or error.
 * See the module header for the invariants. Returns an updated result plus the report fields.
 */
export async function confirmFailures(input: ConfirmFailuresInput): Promise<ConfirmFailuresOutput> {
  const result = structuredClone(input.result);
  const failing = collectFailing(result);
  const readTestFile = input.readTestFile ?? defaultReadTestFile;

  const base: Omit<ConfirmFailuresOutput, 'result'> = {
    isolation_reruns: {
      performed: false,
      skipped_reason: null,
      rerun_count: input.rerunCount,
      entries: [],
    },
    flaky_under_parallel: [],
    meaningful_green: true,
  };

  if (failing.length === 0) {
    return { result, ...base };
  }

  // Re-run cap: a mass failure is a real failure — skip the re-runs and report red.
  const overRatio = failing.length > RERUN_MAX_FAILURE_RATIO * result.summary.total;
  if (failing.length > RERUN_MAX_FAILURES || overRatio) {
    return {
      result,
      ...base,
      isolation_reruns: { ...base.isolation_reruns, skipped_reason: 'too-many-failures' },
    };
  }

  const entries: IsolationRerunEntry[] = [];
  const flaky: FlakyUnderParallel[] = [];
  const recoveredKeys = new Set<string>();
  let registry = await readFlakyRegistry(input.projectRoot);
  let registryChanged = false;

  for (const [index, { issue, bucket }] of failing.entries()) {
    const selector = buildSelector(issue, input.singleSelector);
    if (selector.trim().length === 0) {
      entries.push(rerunEntry(issue, null, 0, 0, 'real', true, 'no-selector'));
      continue;
    }

    const command = buildRerunCommand(
      input.singleCommandTemplate,
      selector,
      input.outputPathPattern,
      index,
    );
    const outcomes: boolean[] = [];
    let allMatchedNothing = true;
    for (let attempt = 0; attempt < input.rerunCount; attempt += 1) {
      const outcome = await input.runSingle(command);
      const summary = outcome.result.summary;
      const matchedNothing = summary.total === 0;
      if (!matchedNothing) allMatchedNothing = false;
      const passed =
        outcome.exitCode === 0 && summary.failed + summary.errored === 0 && summary.total >= 1;
      outcomes.push(passed);
    }

    const judgement = judgeStability({
      test_id: issue.test_id,
      reruns: input.rerunCount,
      rerun: (attempt) => ({ passed: outcomes[attempt] ?? false }),
    });
    const passes = outcomes.filter(Boolean).length;
    const recovered = judgement.verdict === 'recovered';
    const blocking = recovered ? input.flakyMode === 'fail' : true;
    const reason = allMatchedNothing && !recovered ? 'selector-matched-nothing' : undefined;

    entries.push(
      rerunEntry(issue, selector, input.rerunCount, passes, judgement.verdict, blocking, reason),
    );

    if (!recovered) continue;

    // Recovered: quarantine it for tracking and the touch gate (never to change a verdict).
    const source = readSource(input.projectRoot, issue.file_path, readTestFile);
    const suspected = smellCategories(detectFlakinessSmells(source));
    registry = upsertQuarantine(registry, {
      test_id: issue.test_id,
      suite: issue.suite,
      reruns: input.rerunCount,
      passes,
      failures: input.rerunCount - passes,
      suspected_causes: suspected,
      modules: modulesForFile(input.projectRoot, issue.file_path),
      now: input.now(),
    });
    registryChanged = true;
    flaky.push({
      test_id: issue.test_id,
      file_path: issue.file_path,
      line_number: issue.line_number,
      suspected_causes: suspected,
    });
    recoveredKeys.add(`${bucket}:${issue.test_id}:${issue.file_path ?? ''}`);

    // Under warn/pass the recovered test is set aside; under fail it stays blocking.
    if (input.flakyMode !== 'fail') {
      result.warnings.push({
        type: 'flaky-under-parallel',
        message: `Test "${issue.test_id}" failed under parallel but passed every isolated re-run — recorded, not blocking.`,
        source_test_id: issue.test_id,
      });
    }
  }

  // Remove the set-aside tests from failures[]/errors[] and decrement the summary (warn/pass only).
  if (input.flakyMode !== 'fail' && recoveredKeys.size > 0) {
    result.failures = result.failures.filter(
      (issue) => !recoveredKeys.has(`failures:${issue.test_id}:${issue.file_path ?? ''}`),
    );
    result.errors = result.errors.filter(
      (issue) => !recoveredKeys.has(`errors:${issue.test_id}:${issue.file_path ?? ''}`),
    );
    result.summary.failed = result.failures.length;
    result.summary.errored = result.errors.length;
  }

  if (registryChanged) {
    await writeFlakyRegistry(input.projectRoot, registry);
  }

  return {
    result,
    isolation_reruns: {
      performed: true,
      skipped_reason: null,
      rerun_count: input.rerunCount,
      entries,
    },
    flaky_under_parallel: flaky,
    meaningful_green: flaky.length === 0,
  };
}

function rerunEntry(
  issue: StructuredTestIssue,
  selector: string | null,
  attempts: number,
  passes: number,
  verdict: 'real' | 'recovered' | 'flaky',
  blocking: boolean,
  reason?: string,
): IsolationRerunEntry {
  return {
    test_id: issue.test_id,
    file_path: issue.file_path,
    line_number: issue.line_number,
    selector,
    attempts,
    passes,
    verdict,
    blocking,
    ...(reason ? { reason } : {}),
  };
}
