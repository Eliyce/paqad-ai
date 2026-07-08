// Deterministic check runner (issue #318) — the missing producer of real
// test/format/build evidence.
//
// paqad promises: after code is written it runs your format/test/build commands
// and a red result stops the change from being "done". In reality nothing ran
// them — the command resolver was built and tested but had zero callers, and the
// completion backstop hardcoded `code_tests_lint_passed: true`, so a change with
// failing tests could still be reported green by the framework layer.
//
// This module executes the project's own mapped commands and parses each into a
// `StructuredTestResult` — the exact shape the `code-tests-lint` gate already
// consumes — so the framework stops ASSUMING green and starts PROVING it. It is
// strictly deterministic: no LLM, no heuristic — a command's exit code is the
// verdict. It reuses `resolveFeatureDevelopmentCheckCommands` (the existing
// resolver) and the shared delivery shell; it invents no parallel parser.

import type { DeliveryShell } from '@/delivery/runner.js';
import { createDeliveryShell } from '@/delivery/shell.js';
import { readProjectProfile } from '@/core/project-profile.js';
import {
  loadFeatureDevelopmentPolicy,
  resolveFeatureDevelopmentCheckCommands,
} from '@/pipeline/feature-development-policy.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import { TEST_OUTPUT_SCHEMA_VERSION } from '@/core/types/test-output.js';

/** One command's outcome — the deterministic signal is the exit code. */
export interface CheckCommandOutcome {
  /** `format` / `test` / `build`, or null for a raw policy shell command. */
  logical_command: string | null;
  command: string;
  exit_code: number;
  passed: boolean;
}

export interface ChecksRunResult {
  /** At least one command was resolved and executed. */
  ran: boolean;
  /** Every executed command exited 0. Vacuously true when nothing ran. */
  passed: boolean;
  outcomes: CheckCommandOutcome[];
  /** One structured result per executed command, for the verification context. */
  results: StructuredTestResult[];
  /** Resolver warnings (e.g. a logical command missing from the project profile). */
  warnings: string[];
}

export interface RunChecksOptions {
  projectRoot: string;
  /** The files the change touched — attached as each result's evidence scope so the
   *  test-evidence assessment maps the run to the affected code (strong evidence). */
  changedFiles?: readonly string[];
  /** Injectable for tests; defaults to the real execa-backed delivery shell. */
  shell?: DeliveryShell;
  /** Injectable clock for deterministic test timestamps. */
  now?: () => string;
}

/**
 * Resolve and run the feature-development `checks` commands (format / test /
 * build, plus any policy shell commands) against `projectRoot`, returning one
 * structured result per command. Never throws on a failing command — the shell
 * captures the non-zero exit and it surfaces as a `failed` result, so a caller
 * decides the verdict. When no command is mapped (e.g. a project profile without
 * a `test` command) `ran` is false and `results` is empty, so the caller reports
 * Inconclusive rather than a vacuous pass.
 */
export async function runChecks(options: RunChecksOptions): Promise<ChecksRunResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const shell = options.shell ?? createDeliveryShell(options.projectRoot);
  const changedFiles = [...(options.changedFiles ?? [])];

  const profile = readProjectProfile(options.projectRoot);
  const { policy } = loadFeatureDevelopmentPolicy(options.projectRoot, profile);
  const { commands, warnings } = resolveFeatureDevelopmentCheckCommands(
    policy.stages.checks.checks,
    profile,
  );

  const outcomes: CheckCommandOutcome[] = [];
  const results: StructuredTestResult[] = [];

  for (const resolved of commands) {
    const [bin, ...args] = tokenize(resolved.command);
    // A blank command string yields no bin — skip it rather than spawn nothing.
    if (!bin) continue;

    const { stderr, exitCode } = await shell.run(bin, args);
    const passed = exitCode === 0;
    const runnerId = resolved.logical_command ?? resolved.command;

    outcomes.push({
      logical_command: resolved.logical_command,
      command: resolved.command,
      exit_code: exitCode,
      passed,
    });
    results.push(toStructuredResult(runnerId, passed, stderr, changedFiles, now()));
  }

  return {
    ran: outcomes.length > 0,
    passed: outcomes.every((outcome) => outcome.passed),
    outcomes,
    results,
    warnings,
  };
}

/**
 * Split a command string into `[bin, ...args]`. These are the simple,
 * whitespace-separated commands the project profile carries (`pnpm test --
 * --reporter=tap`); there is deliberately no shell interpretation, so the run is
 * reproducible and free of shell-injection surface.
 */
function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/**
 * Build one `StructuredTestResult` from a command's exit code. A command is
 * modelled as a single check: exit 0 → one passed check, non-zero → one failed
 * check carrying a captured-stderr issue. `evidence_scope.related_paths` is the
 * change's files so `assessTestEvidence` maps the run to the affected code.
 */
function toStructuredResult(
  runnerId: string,
  passed: boolean,
  stderr: string,
  changedFiles: string[],
  timestamp: string,
): StructuredTestResult {
  const failure = passed
    ? []
    : [
        {
          test_id: runnerId,
          suite: null,
          message: firstLine(stderr) || `Command "${runnerId}" exited non-zero`,
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
      duration_ms: 0,
      timestamp,
      runner_id: runnerId,
    },
    failures: failure,
    warnings: [],
    parse_metadata: {
      raw_byte_size: 0,
      structured_byte_size: 0,
      compression_ratio: 1,
      original_size: 0,
      compact_size: 0,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      // Exit-code driven, not text-parsed: the strategy is `structured`, never the
      // `degraded` fallback that would make the gate return Inconclusive.
      parse_strategy: 'structured',
      parse_warnings: [],
    },
    errors: [],
    evidence_scope: changedFiles.length > 0 ? { related_paths: changedFiles } : {},
  };
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}
