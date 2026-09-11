import { readFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';

import { Command } from 'commander';

import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { runChecks } from '@/checks/run-checks.js';
import type { ChecksRunResult } from '@/checks/run-checks.js';
import { CHECKS_REPORT_SCHEMA_VERSION } from '@/checks/report-store.js';
import { activeFeatureDirOrNull, writeChecksReportForFeature } from '@/checks/report-target.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import {
  loadFeatureDevelopmentPolicy,
  resolveFeatureDevelopmentCheckCommands,
} from '@/pipeline/feature-development-policy.js';
import { resolveTestPlan } from '@/checks/parallel-plan.js';
import { resolveChecksFlakyMode } from '@/checks/flaky-mode.js';
import { validateRecordRunner } from '@/checks/record-runner.js';
import {
  deriveTestingForProfile,
  lockfileHash,
  resolvePackageEcosystem,
  upsertStackDocCommandRow,
} from '@/checks/testing-record.js';

/**
 * `paqad-ai checks` — the deterministic checks stage (issues #318, #554). `run` executes the mapped
 * commands (overlapped, with the runner's own parallel mode) and blocks on a red result. `plan`
 * prints the resolved plan. `record-runner` records an agent-discovered parallel mode. No LLM is
 * involved: a command's exit code and parsed result files are the verdict.
 */
export function createChecksCommand(): Command {
  const command = new Command('checks').description(
    'Run the project format/test/build checks deterministically and record the result',
  );

  command
    .command('run')
    .description('Run the mapped checks, persist the structured report, and block on failure')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--silent', 'Suppress the machine-readable summary line', false)
    .action(async (options: { projectRoot: string; silent: boolean }) => {
      const changedFiles = (await loadChangeEvidence(options.projectRoot)).files;
      const result = await runChecks({ projectRoot: options.projectRoot, changedFiles });

      const dirName = activeFeatureDirOrNull(options.projectRoot);
      writeChecksReportForFeature(options.projectRoot, dirName, {
        schema_version: CHECKS_REPORT_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        passed: result.passed,
        ran: result.ran,
        results: result.results,
        mode: result.mode,
        commands: result.commands,
        isolation_reruns: result.isolation_reruns,
        flaky_under_parallel: result.flaky_under_parallel,
        meaningful_green: result.meaningful_green,
        critical_path: result.critical_path,
      });

      for (const warning of result.warnings) console.error(`⚠️  ${warning}`);

      if (!result.ran) {
        console.log('**▸ paqad** · no checks mapped — Inconclusive');
        console.log('> ⚪ No format/test/build command is mapped in the project profile.');
        if (!options.silent) console.log(JSON.stringify({ ran: false, passed: null }));
        return;
      }

      const flakyMode = resolveChecksFlakyMode(options.projectRoot);
      for (const line of renderReceipt(result, flakyMode)) console.log(line);

      if (!result.passed) process.exitCode = 1;

      if (!options.silent) {
        console.log(
          JSON.stringify({
            ran: true,
            passed: result.passed,
            test_mode: result.mode.test_mode,
            processes: result.mode.processes,
            recovered: result.recovered,
            duration_ms: result.duration_ms,
          }),
        );
      }
    });

  command
    .command('plan')
    .description('Print the resolved checks plan (stages, test mode, processes) without running')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit the plan as JSON', false)
    .action((options: { projectRoot: string; json: boolean }) => {
      const profile = readProjectProfile(options.projectRoot);
      const { policy } = loadFeatureDevelopmentPolicy(options.projectRoot, profile);
      const { commands } = resolveFeatureDevelopmentCheckCommands(
        policy.stages.checks.checks,
        profile,
      );
      const config = resolveFrameworkConfig(options.projectRoot);
      // Read-only: derive the testing record in-memory when the profile has none yet, so the plan
      // reflects the runner's real parallel mode without a prior `checks run` (no doc mirror write).
      const planProfile =
        profile && !profile.testing && profile.stack_profile
          ? {
              ...profile,
              ...deriveTestingForProfile({
                stackProfile: profile.stack_profile,
                commands: profile.commands,
                projectRoot: options.projectRoot,
                now: new Date().toISOString(),
                mirrorDoc: false,
              }),
            }
          : profile;
      const plan = planProfile
        ? resolveTestPlan(
            planProfile,
            { availableParallelism: availableParallelism(), totalmem: totalmem() },
            {
              checksParallel: config.features.checks_parallel,
              checksMaxProcesses: config.features.checks_max_processes,
            },
          )
        : { command: '', mode: 'sequential' as const, processes: null, reason: 'no-profile' };

      const stage1 = commands
        .filter((c) => c.logical_command === 'format' || c.logical_command === 'lint')
        .map((c) => c.command);
      const stage2 = commands
        .filter(
          (c) =>
            c.logical_command !== 'format' &&
            c.logical_command !== 'lint' &&
            c.logical_command !== 'test',
        )
        .map((c) => c.command);

      if (options.json) {
        console.log(
          JSON.stringify({
            stage_1: stage1,
            stage_2: stage2,
            test_command: plan.command,
            test_mode: plan.mode,
            processes: plan.processes,
            reason: plan.reason,
          }),
        );
        return;
      }
      console.log('**▸ paqad** · checks plan');
      console.log(`> stage 1 (serial): ${stage1.join(', ') || '—'}`);
      console.log(`> stage 2 (concurrent): ${stage2.join(', ') || '—'}`);
      console.log(`> test: ${describeTestMode(plan.mode, plan.processes, plan.reason)}`);
    });

  command
    .command('record-runner')
    .description('Record an agent-discovered test-runner parallel mode (validated, never trusted)')
    .argument('<file>', 'Path to the discovery JSON the test-runner-discovery skill produced')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((file: string, options: { projectRoot: string }) => {
      const profile = readProjectProfile(options.projectRoot);
      if (!profile) {
        console.error('no project profile — run onboarding first');
        process.exitCode = 2;
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        console.error(`could not read or parse discovery file "${file}"`);
        process.exitCode = 2;
        return;
      }
      const ecosystem = profile.stack_profile
        ? resolvePackageEcosystem(profile.stack_profile.frameworks, options.projectRoot)
        : null;
      const result = validateRecordRunner(
        raw,
        profile,
        options.projectRoot,
        new Date().toISOString(),
        lockfileHash(options.projectRoot, ecosystem),
      );
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 2;
        return;
      }
      const next = {
        ...profile,
        commands: result.testParallel
          ? { ...profile.commands, test_parallel: result.testParallel }
          : profile.commands,
        testing: result.testing,
      };
      writeProjectProfile(options.projectRoot, next, 'checks: recorded agent-discovered runner');
      if (result.testParallel) {
        upsertStackDocCommandRow(options.projectRoot, 'Test (parallel)', result.testParallel);
      }
      console.log(
        `recorded testing.parallel=${result.testing.parallel} for ${result.testing.runner_id}`,
      );
    });

  return command;
}

function describeTestMode(
  mode: 'native' | 'parallel' | 'sequential',
  processes: number | null,
  reason: string | null,
): string {
  if (mode === 'parallel') return `parallel ×${processes}`;
  if (mode === 'native') return 'native';
  return `sequential (${reason ?? 'unknown'})`;
}

/** Wall-clock seconds, `13 s` or `2 m 04 s`. */
function fmtSecs(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min} m ${String(sec).padStart(2, '0')} s`;
}

function commandName(logical: string | null, command: string): string {
  return logical ?? command;
}

/** The end-of-change receipt (issue #554, Part E.2). Verbatim shapes, plain language. */
export function renderReceipt(result: ChecksRunResult, flakyMode: 'pass' | 'warn' | 'fail'): string[] {
  const lines: string[] = [];
  const header = result.passed
    ? `**▸ paqad** · checks green — Safe to merge (${fmtSecs(result.duration_ms)})`
    : `**▸ paqad** · checks failed — Needs your attention (${fmtSecs(result.duration_ms)})`;
  lines.push(header);

  for (const command of result.commands) {
    if (command.logical_command === 'test') {
      lines.push(...renderTestLines(result, command.duration_ms));
      continue;
    }
    const glyph = command.passed ? '🟢' : '🔴';
    const suffix = command.passed ? 'passed' : `failed (exit ${command.exit_code})`;
    lines.push(
      `> - ${glyph} ${commandName(command.logical_command, command.command)} ${suffix} (${fmtSecs(command.duration_ms)})`,
    );
  }

  // Flaky-under-parallel line.
  if (result.recovered > 0) {
    if (flakyMode === 'fail') {
      lines.push(
        `> - 🔴 ${result.recovered} tests pass alone but fail in the suite (checks_flaky_under_parallel=fail)`,
      );
    } else if (flakyMode === 'warn') {
      lines.push(
        `> - 🟡 ${result.recovered} tests failed under parallel and passed alone; recorded, not blocking`,
      );
    }
  }

  // Sequential fallback line.
  if (result.sequential_reason) {
    lines.push(`> - 🟡 test ran sequentially: ${humanReason(result.sequential_reason)}`);
  }

  lines.push(
    `> - Critical path: ${result.critical_path.logical_command ?? '—'} (${fmtSecs(result.critical_path.duration_ms)} of ${fmtSecs(result.duration_ms)} total work)`,
  );
  return lines;
}

function renderTestLines(result: ChecksRunResult, durationMs: number): string[] {
  const test = result.test_result;
  const blocking = test ? test.summary.failed + test.summary.errored : 0;
  const modeSuffix =
    result.mode.test_mode === 'parallel'
      ? `parallel ×${result.mode.processes}`
      : result.mode.test_mode === 'native'
        ? 'native parallel'
        : '';
  if (blocking === 0) {
    const suffix = modeSuffix ? `, ${modeSuffix}` : '';
    return [
      `> - 🟢 test passed: ${result.test_total} tests${suffix} (${fmtSecs(durationMs)})`,
    ];
  }
  const lines = [
    `> - 🔴 test failed: ${blocking} tests fail alone (${result.parallel_failures} failed in the parallel run)`,
  ];
  if (test) {
    for (const issue of [...test.failures, ...test.errors]) {
      const loc = issue.file_path
        ? `${issue.file_path}${issue.line_number !== null ? `:${issue.line_number}` : ''}`
        : '(unknown location)';
      const name = issue.test_id.includes('::') ? issue.test_id.split('::').pop() : issue.test_id;
      lines.push(`>     ${loc} › ${name}`);
    }
  }
  return lines;
}

function humanReason(reason: string): string {
  if (reason.endsWith('-missing')) {
    const pkg = reason.replace(/-missing$/, '');
    const short = pkg.split('/').pop() ?? pkg;
    return `${short} missing (${pkg})`;
  }
  if (reason === 'too-few-cores') return 'fewer than 4 cores';
  if (reason.startsWith('harness-failure')) return 'the parallel harness failed';
  if (reason === 'unknown') return 'parallel mode unknown; run the test-runner-discovery skill, then npx paqad-ai checks record-runner <file>';
  return reason;
}
