// Deterministic check runner (issue #318, made fast without lowering the bar by #554).
//
// It executes the project's mapped format/test/build commands and parses each into a
// `StructuredTestResult` — the shape the `code-tests-lint` gate consumes. Since #554 it runs the
// commands as `&&` argv chains (never a shell), overlaps them with a scheduler, runs the test suite
// with the runner's own parallel mode when the project has it, falls back to the sequential command
// on a harness failure, and confirms every parallel-run failure alone before it blocks. Everything
// at runtime is deterministic: exit codes, parsed result files, arithmetic. No LLM call from Node.

import { availableParallelism as osAvailableParallelism, totalmem as osTotalmem } from 'node:os';
import { rmSync } from 'node:fs';

import fg from 'fast-glob';

import type { DeliveryShell } from '@/delivery/runner.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import {
  loadFeatureDevelopmentPolicy,
  resolveFeatureDevelopmentCheckCommands,
} from '@/pipeline/feature-development-policy.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import { runStages } from '@/checks/scheduler.js';
import type { ScheduledCommand, ScheduledCommandResult } from '@/checks/scheduler.js';
import { resolveTestPlan } from '@/checks/parallel-plan.js';
import type { OsFacts, TestPlan } from '@/checks/parallel-plan.js';
import { selectTestRunner } from '@/checks/test-runner.js';
import {
  deriveTestingForProfile,
  lockfileHash,
  resolvePackageEcosystem,
} from '@/checks/testing-record.js';
import { confirmFailures } from '@/checks/isolation-rerun.js';
import type { ChecksFlakyMode } from '@/checks/isolation-rerun.js';
import { resolveChecksFlakyMode } from '@/checks/flaky-mode.js';
import { resolveRerunCount } from '@/flaky/stability.js';
import { OUTPUT_TAIL_LINES } from '@/checks/constants.js';
import { parseTestOutput } from '@/test-output/service.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { TEST_OUTPUT_SCHEMA_VERSION } from '@/core/types/test-output.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { StackPackTestRunner } from '@/core/types/pack.js';
import type {
  ChecksReportCommand,
  ChecksReportCriticalPath,
  ChecksReportFlaky,
  ChecksReportIsolation,
  ChecksReportMode,
} from '@/checks/report-store.js';

export interface ChecksRunResult {
  ran: boolean;
  passed: boolean;
  results: StructuredTestResult[];
  warnings: string[];
  mode: ChecksReportMode;
  commands: ChecksReportCommand[];
  isolation_reruns: ChecksReportIsolation;
  flaky_under_parallel: ChecksReportFlaky[];
  meaningful_green: boolean;
  critical_path: ChecksReportCriticalPath;
  /** Count of tests set aside as flaky-under-parallel (for the --silent line). */
  recovered: number;
  /** Total work time across every command (sum of durations). */
  duration_ms: number;
  /** Why the test ran sequentially (paratest-missing, too-few-cores, harness-failure:…, unknown), for
   *  the receipt line; null when it ran parallel/native or sequential by the user's own choice. */
  sequential_reason: string | null;
  /** The parsed test result's total test count and the pre-isolation parallel failure count. */
  test_total: number;
  parallel_failures: number;
  /** The final (post-isolation) parsed test result, for the failing-test list; null when no test ran. */
  test_result: StructuredTestResult | null;
}

export interface RunChecksOptions {
  projectRoot: string;
  changedFiles?: readonly string[];
  shell?: DeliveryShell;
  now?: () => string;
  /** Injectable ms clock and os facts so a unit test never depends on the host. */
  nowMs?: () => number;
  osFacts?: OsFacts;
  checksParallel?: boolean;
  checksMaxProcesses?: number;
  flakyMode?: ChecksFlakyMode;
}

const EMPTY_ISOLATION: ChecksReportIsolation = {
  performed: false,
  skipped_reason: null,
  rerun_count: 0,
  entries: [],
};

export async function runChecks(options: RunChecksOptions): Promise<ChecksRunResult> {
  const projectRoot = options.projectRoot;
  const nowIso = options.now ?? (() => new Date().toISOString());
  const nowMs = options.nowMs ?? (() => Date.now());
  const shell = options.shell ?? createDeliveryShell(projectRoot);
  const changedFiles = [...(options.changedFiles ?? [])];
  const osFacts = options.osFacts ?? {
    availableParallelism: osAvailableParallelism(),
    totalmem: osTotalmem(),
  };

  let profile = readProjectProfile(projectRoot);
  const { policy } = loadFeatureDevelopmentPolicy(projectRoot, profile);
  const { commands: resolvedCommands, warnings } = resolveFeatureDevelopmentCheckCommands(
    policy.stages.checks.checks,
    profile,
  );

  const config = resolveFrameworkConfig(projectRoot);
  const checksParallel = options.checksParallel ?? config.features.checks_parallel;
  const checksMaxProcesses = options.checksMaxProcesses ?? config.features.checks_max_processes;
  const flakyMode = options.flakyMode ?? resolveChecksFlakyMode(projectRoot);

  if (profile) profile = refreshTestingRecord(profile, projectRoot, nowIso());

  const plan: TestPlan = profile
    ? resolveTestPlan(profile, osFacts, { checksParallel, checksMaxProcesses })
    : /* v8 ignore next -- no profile ⇒ no mapped commands ⇒ emptyResult below; the plan is unused */
      { command: '', mode: 'sequential', processes: null, reason: 'no-profile' };

  const runner = profile?.stack_profile
    ? selectTestRunner(profile.stack_profile, profile.commands.test, projectRoot)
    : null;

  const scheduled: ScheduledCommand[] = [];
  let hasTest = false;
  for (const resolved of resolvedCommands) {
    if (resolved.command.trim().length === 0) continue;
    if (resolved.logical_command === 'format' || resolved.logical_command === 'lint') {
      scheduled.push({
        logical_command: resolved.logical_command,
        command: resolved.command,
        stage: 1,
      });
    } else if (resolved.logical_command === 'test') {
      hasTest = true;
      scheduled.push({ logical_command: 'test', command: plan.command, stage: 3 });
    } else {
      scheduled.push({
        logical_command: resolved.logical_command,
        command: resolved.command,
        stage: 2,
      });
    }
  }

  if (scheduled.length === 0) return emptyResult(warnings, checksParallel);

  if (runner) deleteRunnerOutput(projectRoot, runner);

  const runResults = await runStages(scheduled, shell, {
    cwd: projectRoot,
    parallel: checksParallel,
    availableParallelism: osFacts.availableParallelism,
    nowMs,
    nowIso,
  });

  const reportCommands: ChecksReportCommand[] = [];
  const results: StructuredTestResult[] = [];
  let testMode = plan.mode;
  let fallbackReason: string | null = null;
  let isolation: ChecksReportIsolation = { ...EMPTY_ISOLATION };
  let flaky: ChecksReportFlaky[] = [];
  let meaningfulGreen = true;
  let recovered = 0;
  let testResult: StructuredTestResult | null = null;

  for (const runResult of runResults) {
    reportCommands.push(toReportCommand(runResult));
    if (runResult.logical_command !== 'test') {
      results.push(exitCodeResult(runResult, changedFiles, nowIso()));
      continue;
    }

    let parsed = await parseTestCommandOutputAsync(runner, runResult, projectRoot, changedFiles);

    // Harness-failure fallback: a parallel run that produced no parsed test result means the
    // parallel harness itself failed (paratest missing, DB denied, …) — run sequentially once.
    if (
      plan.mode === 'parallel' &&
      runResult.exit_code !== 0 &&
      (parsed.summary.total === 0 || parsed.parse_metadata.parse_strategy === 'degraded')
    ) {
      const seq = await runOneCommand(shell, profile!.commands.test, projectRoot, nowMs, nowIso);
      reportCommands.push(toReportCommand(seq));
      parsed = await parseTestCommandOutputAsync(runner, seq, projectRoot, changedFiles);
      testMode = 'sequential';
      fallbackReason = `harness-failure:${firstLine(runResult.stderr).slice(0, 200)}`;
      if (profile) profile = persistHarnessFallback(profile, projectRoot, nowIso());
    }

    if (profile && runner && parsed.summary.failed + parsed.summary.errored > 0) {
      const confirmed = await confirmFailures({
        result: parsed,
        projectRoot,
        singleCommandTemplate: profile.commands.test_single,
        singleSelector: runner.single_test_selector ?? 'test_id',
        outputPathPattern: runner.output_path_pattern,
        flakyMode,
        rerunCount: resolveRerunCount(projectRoot),
        now: nowIso,
        runSingle: async (command, outputOverride) => {
          const outcome = await runOneCommand(shell, command, projectRoot, nowMs, nowIso);
          // Parse the re-run's REDIRECTED output file (rerun-<index>), not the runner's default one,
          // so an isolated re-run never reads the crowd run's result file.
          const rerunRunner =
            outputOverride && runner.output_source === 'file'
              ? { ...runner, output_path_pattern: outputOverride }
              : /* v8 ignore next -- stdout runners parse from captured output, no redirect override */
                runner;
          return {
            exitCode: outcome.exit_code,
            result: await parseTestCommandOutputAsync(
              rerunRunner,
              outcome,
              projectRoot,
              changedFiles,
            ),
          };
        },
      });
      parsed = confirmed.result;
      isolation = confirmed.isolation_reruns;
      flaky = confirmed.flaky_under_parallel;
      meaningfulGreen = confirmed.meaningful_green;
      recovered = flaky.length;
    }

    testResult = parsed;
    results.push(parsed);
  }

  const nonTestPassed = runResults
    .filter((r) => r.logical_command !== 'test')
    .every((r) => r.passed);
  const blocking = testResult ? testResult.summary.failed + testResult.summary.errored : 0;
  const passed = nonTestPassed && blocking === 0;
  const sequentialReason =
    hasTest && testMode === 'sequential'
      ? (fallbackReason ?? (plan.reason && plan.reason !== 'disabled' ? plan.reason : null))
      : null;
  const parallelFailures = isolation.performed ? isolation.entries.length : blocking;

  const durationTotal = reportCommands.reduce((acc, command) => acc + command.duration_ms, 0);
  const criticalPath = reportCommands.reduce<ChecksReportCriticalPath>(
    (max, command) =>
      command.duration_ms > max.duration_ms
        ? { logical_command: command.logical_command, duration_ms: command.duration_ms }
        : max,
    { logical_command: null, duration_ms: 0 },
  );

  return {
    ran: true,
    passed,
    results,
    warnings,
    mode: {
      parallel_commands: checksParallel,
      test_mode: hasTest ? testMode : 'sequential',
      processes: testMode === 'parallel' ? plan.processes : null,
      fallback_reason: fallbackReason,
    },
    commands: reportCommands,
    isolation_reruns: isolation,
    flaky_under_parallel: flaky,
    meaningful_green: meaningfulGreen,
    critical_path: criticalPath,
    recovered,
    duration_ms: durationTotal,
    sequential_reason: sequentialReason,
    test_total: testResult?.summary.total ?? 0,
    parallel_failures: parallelFailures,
    test_result: testResult,
  };
}

function toReportCommand(result: ScheduledCommandResult): ChecksReportCommand {
  const tail =
    !result.passed && (result.stdout || result.stderr || result.invalid)
      ? [result.invalid ?? '', result.stdout, result.stderr]
          .filter(Boolean)
          .join('\n')
          .split('\n')
          .slice(-OUTPUT_TAIL_LINES)
      : undefined;
  return {
    logical_command: result.logical_command,
    command: result.command,
    exit_code: result.exit_code,
    passed: result.passed,
    stage: result.stage,
    started_at: result.started_at,
    ended_at: result.ended_at,
    duration_ms: result.duration_ms,
    ...(tail && tail.length > 0 ? { output_tail: tail } : {}),
  };
}

async function runOneCommand(
  shell: DeliveryShell,
  command: string,
  cwd: string,
  nowMs: () => number,
  nowIso: () => string,
): Promise<ScheduledCommandResult> {
  const started_at = nowIso();
  const startMs = nowMs();
  const parsed = parseCommandChain(command);
  const finish = (
    exit: number,
    stdout: string,
    stderr: string,
    invalid?: string,
  ): ScheduledCommandResult => ({
    logical_command: 'test',
    command,
    stage: 3,
    exit_code: exit,
    passed: exit === 0,
    started_at,
    ended_at: nowIso(),
    duration_ms: Math.max(0, nowMs() - startMs),
    stdout,
    stderr,
    ...(invalid ? { invalid } : {}),
  });
  /* v8 ignore next 3 -- runOneCommand only runs commands the scheduler already validated (fallback + re-runs) */
  if (!parsed.ok) {
    return finish(1, '', '', `Unsupported shell syntax in mapped command: ${parsed.invalidToken}`);
  }
  const res = await runCommandChain(shell, parsed.steps, cwd);
  return finish(res.exitCode, res.stdout, res.stderr);
}

async function parseTestCommandOutputAsync(
  runner: StackPackTestRunner | null,
  result: ScheduledCommandResult,
  projectRoot: string,
  changedFiles: string[],
): Promise<StructuredTestResult> {
  if (!runner || runner.structured_format === 'none') {
    return plainTextResult(result, changedFiles);
  }
  const parsed = await parseTestOutput({
    runner,
    cwd: projectRoot,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return withEvidence(parsed, changedFiles);
}

function plainTextResult(
  result: ScheduledCommandResult,
  changedFiles: string[],
): StructuredTestResult {
  return withEvidence(
    baseResult('test', result.passed, firstLine(result.stderr), 'plain-text-fallback', {
      raw_byte_size: (result.stdout.length + result.stderr.length) | 0,
    }),
    changedFiles,
  );
}

function exitCodeResult(
  result: ScheduledCommandResult,
  changedFiles: string[],
  timestamp: string,
): StructuredTestResult {
  const runnerId = result.logical_command ?? result.command;
  const message =
    result.invalid ?? (firstLine(result.stderr) || `Command "${runnerId}" exited non-zero`);
  return withEvidence(
    baseResult(runnerId, result.passed, message, 'structured', {
      raw_byte_size: 0,
      duration_ms: result.duration_ms,
      timestamp,
    }),
    changedFiles,
  );
}

function baseResult(
  runnerId: string,
  passed: boolean,
  message: string,
  strategy: 'structured' | 'plain-text-fallback',
  extra: { raw_byte_size: number; duration_ms?: number; timestamp?: string },
): StructuredTestResult {
  const failure = passed
    ? []
    : [
        {
          test_id: runnerId,
          suite: null,
          message,
          stack_trace: null,
          file_path: null,
          line_number: null,
          category: 'error' as const,
          duration_ms: null,
        },
      ];
  return {
    schema_version: TEST_OUTPUT_SCHEMA_VERSION,
    summary: {
      total: 1,
      passed: passed ? 1 : 0,
      failed: passed ? 0 : 1,
      skipped: 0,
      errored: 0,
      duration_ms: extra.duration_ms ?? 0,
      timestamp: extra.timestamp ?? '1970-01-01T00:00:00.000Z',
      runner_id: runnerId,
    },
    failures: failure,
    warnings: [],
    parse_metadata: {
      raw_byte_size: extra.raw_byte_size,
      structured_byte_size: 0,
      compression_ratio: 1,
      original_size: 0,
      compact_size: 0,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: strategy,
      parse_warnings: [],
    },
    errors: [],
    evidence_scope: {},
  };
}

function withEvidence(result: StructuredTestResult, changedFiles: string[]): StructuredTestResult {
  return changedFiles.length > 0
    ? { ...result, evidence_scope: { related_paths: changedFiles } }
    : result;
}

function refreshTestingRecord(
  profile: ProjectProfile,
  projectRoot: string,
  now: string,
): ProjectProfile {
  if (!profile.stack_profile) return profile;
  const ecosystem = resolvePackageEcosystem(profile.stack_profile.frameworks, projectRoot);
  const currentHash = lockfileHash(projectRoot, ecosystem);
  const recorded = profile.testing;
  const stale = !recorded || (currentHash !== undefined && recorded.lockfile_hash !== currentHash);
  if (!stale) return profile;

  const derived = deriveTestingForProfile({
    stackProfile: profile.stack_profile,
    commands: profile.commands,
    projectRoot,
    now,
  });
  if (!derived.testing) return profile;
  const next: ProjectProfile = { ...profile, commands: derived.commands, testing: derived.testing };
  writeProjectProfile(projectRoot, next, 'checks: recorded test runner parallel mode');
  return next;
}

function persistHarnessFallback(
  profile: ProjectProfile,
  projectRoot: string,
  now: string,
): ProjectProfile {
  const ecosystem = profile.stack_profile
    ? resolvePackageEcosystem(profile.stack_profile.frameworks, projectRoot)
    : /* v8 ignore next -- a harness fallback only happens on a parallel run, which requires a stack_profile */
      null;
  const hash = lockfileHash(projectRoot, ecosystem);
  const next: ProjectProfile = {
    ...profile,
    testing: {
      runner_id: profile.testing?.runner_id ?? 'unknown',
      parallel: 'unavailable',
      reason: 'harness-failure',
      detected_by: 'script',
      /* v8 ignore next -- a parallel run implies a resolvable lockfile, so `hash` is present here */
      ...(hash ? { lockfile_hash: hash } : {}),
      recorded_at: now,
    },
  };
  writeProjectProfile(projectRoot, next, 'checks: parallel harness failure — pinned sequential');
  return next;
}

function deleteRunnerOutput(projectRoot: string, runner: StackPackTestRunner): void {
  if (runner.output_source !== 'file' || !runner.output_path_pattern) return;
  try {
    for (const match of fg.sync(runner.output_path_pattern, { cwd: projectRoot, absolute: true })) {
      rmSync(match, { force: true });
    }
  } catch {
    /* v8 ignore next -- a failed pre-clean just means the parser may read a stale file; not fatal */
  }
}

function emptyResult(warnings: string[], checksParallel: boolean): ChecksRunResult {
  return {
    ran: false,
    passed: true,
    results: [],
    warnings,
    mode: {
      parallel_commands: checksParallel,
      test_mode: 'sequential',
      processes: null,
      fallback_reason: null,
    },
    commands: [],
    isolation_reruns: { ...EMPTY_ISOLATION },
    flaky_under_parallel: [],
    meaningful_green: true,
    critical_path: { logical_command: null, duration_ms: 0 },
    recovered: 0,
    duration_ms: 0,
    sequential_reason: null,
    test_total: 0,
    parallel_failures: 0,
    test_result: null,
  };
}

function firstLine(text: string): string {
  /* v8 ignore next -- split always yields at least one element, so [0] is defined */
  return text.split('\n')[0]?.trim() ?? '';
}
