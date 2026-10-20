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

export interface IsolationRerunEntry {
  test_id: string;
  file_path: string | null;
  line_number: number | null;
  selector: string | null;
  attempts: number;
  passes: number;
  verdict: 'real' | 'recovered' | 'flaky';
  blocking: boolean;
  reason?: string;
}

export interface FlakyUnderParallel {
  test_id: string;
  file_path: string | null;
  line_number: number | null;
  suspected_causes: string[];
}

export interface SingleRunOutcome {
  exitCode: number;
  result: StructuredTestResult;
}

export interface ConfirmFailuresInput {
  result: StructuredTestResult;
  projectRoot: string;
  singleCommandTemplate: string;
  singleSelector: SingleTestSelector;
  outputPathPattern?: string;
  flakyMode: ChecksFlakyMode;
  rerunCount: number;
  now: () => string;
  runSingle: (command: string, outputOverride?: string) => Promise<SingleRunOutcome>;
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

function buildSelector(issue: StructuredTestIssue, selector: SingleTestSelector): string {
  if (selector === 'file') return issue.file_path ?? '';
  const id = issue.test_id ?? '';
  return id.includes('::') ? (id.split('::').pop() ?? '') : id;
}

function buildRerunCommand(
  template: string,
  selector: string,
  outputPathPattern: string | undefined,
  index: number,
): string {
  let command = template.split('<pattern>').join(selector).split('<path_or_file>').join(selector);
  const redirected = rerunOutputPath(outputPathPattern, index);
  if (outputPathPattern && redirected && command.includes(outputPathPattern)) {
    command = command.split(outputPathPattern).join(redirected);
  }
  return command;
}

function rerunOutputPath(outputPathPattern: string | undefined, index: number): string | undefined {
  if (!outputPathPattern) return undefined;
  const ext = extname(outputPathPattern).replace(/^\./, '') || 'out';
  return `.paqad/test-results/rerun-${index}.${ext}`;
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
    const rerunOutput = rerunOutputPath(input.outputPathPattern, index);
    const outcomes: boolean[] = [];
    let allMatchedNothing = true;
    for (let attempt = 0; attempt < input.rerunCount; attempt += 1) {
      const outcome = await input.runSingle(command, rerunOutput);
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

    if (input.flakyMode !== 'fail') {
      result.warnings.push({
        type: 'flaky-under-parallel',
        message: `Test "${issue.test_id}" failed under parallel but passed every isolated re-run — recorded, not blocking.`,
        source_test_id: issue.test_id,
      });
    }
  }

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
