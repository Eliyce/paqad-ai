import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { execa } from 'execa';

import { readChecksReportForFeature } from '@/checks/report-target.js';
import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import type { ProofCheck, ProofRunResult } from '@/core/types/fix-protocol.js';
import type { TestIssueSnapshot } from '@/core/types/token-efficiency.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { readGitState } from '@/rag/git-state.js';
import { isOnPath } from '@/rule-scripts/execute.js';

import { behaviourChangeOf, readChangeDiff } from './fix-change.js';
import {
  appendFixProofRow,
  countedRedRow,
  readFixProofRows,
  type FixProofPhase,
  type FixProofRow,
} from './fix-proof-record.js';
import { runFixProtocol } from './fix-protocol.js';

export const DEFAULT_PROOF_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_LINES = 40;
const COMMAND_NOT_RUNNABLE_CODES = new Set([126, 127]);

export interface ProofCommandResult {
  exit_code: number | null;
  timed_out: boolean;
  spawn_failed: boolean;
  invalid: string | null;
  output: string;
  duration_ms: number;
}

export type ProofCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<ProofCommandResult>;

function commandPath(bin: string, cwd: string): string {
  return bin.includes('/') || bin.includes('\\') ? resolve(cwd, bin) : bin;
}

export const runProofCommand: ProofCommandRunner = async (command, cwd, timeoutMs) => {
  const started = Date.now();
  const parsed = parseCommandChain(command);
  if (!parsed.ok || parsed.steps.length === 0) {
    return {
      exit_code: null,
      timed_out: false,
      spawn_failed: false,
      invalid: parsed.ok ? 'empty command' : `unsupported shell syntax: ${parsed.invalidToken}`,
      output: '',
      duration_ms: 0,
    };
  }
  const flags = { timedOut: false, spawnFailed: false };
  const deadline = started + timeoutMs;
  const shell: DeliveryShell = {
    async run(bin, args) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await execa(bin, args, { cwd, reject: false, timeout: remaining });
      if (result.timedOut) flags.timedOut = true;
      const missing =
        result.code === 'ENOENT' ||
        (result.exitCode !== 0 && !result.timedOut && !isOnPath(commandPath(bin, cwd)));
      const exitCode = missing ? 127 : typeof result.exitCode === 'number' ? result.exitCode : 1;
      if (missing) flags.spawnFailed = true;
      return { stdout: result.stdout, stderr: result.stderr, exitCode };
    },
  };
  const outcome = await runCommandChain(shell, parsed.steps, cwd);
  return {
    exit_code: outcome.exitCode,
    timed_out: flags.timedOut,
    spawn_failed: flags.spawnFailed,
    invalid: null,
    output: [outcome.stdout, outcome.stderr].filter((part) => part.length > 0).join('\n'),
    duration_ms: Date.now() - started,
  };
};

export interface FixProveInput {
  projectRoot: string;
  dirName: string;
  sessionId: string;
  phase: FixProofPhase;
  testFile: string;
  testId: string;
  command: string;
  timeoutMs?: number;
  now?: () => Date;
  runCommand?: ProofCommandRunner;
}

function treeDirty(projectRoot: string): boolean | null {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return status.trim().length > 0;
  } catch {
    return null;
  }
}

function tail(output: string): string[] {
  const lines = output.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(-OUTPUT_TAIL_LINES);
}

function commandError(result: ProofCommandResult): string | null {
  if (result.invalid !== null) return `The proof command was not run: ${result.invalid}.`;
  if (result.timed_out) return 'The proof command timed out, so it proves nothing.';
  if (result.exit_code === null)
    return 'The proof command gave no exit code, so it proves nothing.';
  if (result.spawn_failed || COMMAND_NOT_RUNNABLE_CODES.has(result.exit_code)) {
    return `The proof command could not run (exit ${result.exit_code}); check the command.`;
  }
  return null;
}

function failingIssues(projectRoot: string, dirName: string): TestIssueSnapshot[] {
  const report = readChecksReportForFeature(projectRoot, dirName);
  if (!report) return [];
  return report.results.flatMap((result) => [
    ...result.failures.map((issue) => ({
      test_id: issue.test_id,
      message: issue.message,
      status: 'failed' as const,
    })),
    ...result.errors.map((issue) => ({
      test_id: issue.test_id,
      message: issue.message,
      status: 'errored' as const,
    })),
  ]);
}

function defectIdFor(dirName: string): string {
  return `fix-${featureChangeKey(dirName)}`;
}

export async function proveFix(input: FixProveInput): Promise<FixProofRow> {
  const now = input.now ?? (() => new Date());
  const runCommand = input.runCommand ?? runProofCommand;
  const proof: ProofCheck = {
    test_file: input.testFile,
    test_id: input.testId,
    command: input.command,
  };
  const git = readGitState(input.projectRoot);
  const base = {
    phase: input.phase,
    test_file: input.testFile,
    test_id: input.testId,
    command: input.command,
    commit: git.head_commit ?? null,
    tree_dirty: treeDirty(input.projectRoot),
  };

  let lastRun: ProofCommandResult | null = null;
  const runOnce = async (): Promise<ProofCommandResult> => {
    lastRun = await runCommand(
      input.command,
      input.projectRoot,
      input.timeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS,
    );
    return lastRun;
  };
  const rowFrom = (
    run: ProofCommandResult,
    fields: Pick<FixProofRow, 'outcome' | 'reason'> & Partial<FixProofRow>,
  ): FixProofRow => ({
    ...base,
    exit_code: run.exit_code,
    timed_out: run.timed_out,
    duration_ms: run.duration_ms,
    at: now().toISOString(),
    output_tail: tail(run.output),
    ...fields,
  });

  let row: FixProofRow;
  if (input.phase === 'red') {
    const run = await runOnce();
    const error = commandError(run);
    if (error !== null) {
      row = rowFrom(run, { outcome: 'error', reason: error });
    } else if (run.exit_code === 0) {
      row = rowFrom(run, {
        outcome: 'not-reproduced',
        reason: `Proof "${input.testId}" passed before the fix, so it does not reproduce the problem.`,
      });
    } else if (!run.output.includes(input.testId)) {
      row = rowFrom(run, {
        outcome: 'error',
        reason: `The command failed without naming "${input.testId}", so it is not counted as the test failing.`,
      });
    } else {
      row = rowFrom(run, {
        outcome: 'red',
        reason: `Proof "${input.testId}" fails before the fix.`,
        baseline_failing: failingIssues(input.projectRoot, input.dirName).map(
          (issue) => issue.test_id,
        ),
      });
    }
  } else {
    row = await proveGreen(input, proof, runOnce, rowFrom, () => lastRun, now);
  }

  appendFixProofRow(input.projectRoot, input.dirName, row, {
    sessionId: input.sessionId,
    now,
  });
  return row;
}

async function proveGreen(
  input: FixProveInput,
  proof: ProofCheck,
  runOnce: () => Promise<ProofCommandResult>,
  rowFrom: (
    run: ProofCommandResult,
    fields: Pick<FixProofRow, 'outcome' | 'reason'> & Partial<FixProofRow>,
  ) => FixProofRow,
  lastRun: () => ProofCommandResult | null,
  now: () => Date,
): Promise<FixProofRow> {
  const red = countedRedRow(readFixProofRows(input.projectRoot, input.dirName));
  if (red === null) {
    const run = await runOnce();
    const error = commandError(run);
    if (error !== null) return rowFrom(run, { outcome: 'error', reason: error });
    return run.exit_code === 0
      ? rowFrom(run, {
          outcome: 'green',
          reason: `Proof "${input.testId}" passes, but no red run was recorded before the fix.`,
        })
      : rowFrom(run, {
          outcome: 'still-failing',
          reason: `Proof "${input.testId}" still fails.`,
        });
  }

  const recordedRed: ProofRunResult = { passed: false, output: red.output_tail.join('\n') };
  const baseline: TestIssueSnapshot[] = (red.baseline_failing ?? []).map((testId) => ({
    test_id: testId,
    message: '',
    status: 'failed',
  }));
  const result = await runFixProtocol({
    project_root: input.projectRoot,
    defect_id: defectIdFor(input.dirName),
    change: behaviourChangeOf(readChangeDiff(input.projectRoot) ?? { files: [] }),
    proof,
    baseline: { captured_at: red.at, source: 'reused-evidence', issues: baseline },
    failing_evidence: {
      category: 'test-failure',
      file: red.test_file,
      line: null,
      test_id: red.test_id,
      suite: null,
      ac_id: null,
      message: red.reason,
      stderr_excerpt: red.output_tail.slice(-5).join('\n') || null,
    },
    now: now().toISOString(),
    runProofOnUnfixedTree: async () => recordedRed,
    applyFix: async () => {},
    runProofOnFixedTree: async () => {
      const run = await runOnce();
      return { passed: run.exit_code === 0 && commandError(run) === null, output: run.output };
    },
    runFullSuiteAfterFix: async () => failingIssues(input.projectRoot, input.dirName),
  });

  const run = lastRun() ?? (await runOnce());
  const error = commandError(run);
  if (error !== null) {
    return rowFrom(run, { outcome: 'error', reason: error, protocol_status: result.status });
  }
  switch (result.status) {
    case 'fixed':
      return rowFrom(run, {
        outcome: 'green',
        reason: result.reason,
        protocol_status: result.status,
        guard_path: result.guard_path,
      });
    case 'skipped-no-behaviour-change':
      return rowFrom(run, {
        outcome: run.exit_code === 0 ? 'green' : 'still-failing',
        reason: result.reason,
        protocol_status: result.status,
      });
    case 'rejected-proof-still-failing':
      return rowFrom(run, {
        outcome: 'still-failing',
        reason: result.reason,
        protocol_status: result.status,
      });
    default:
      return rowFrom(run, {
        outcome: 'held',
        reason: result.reason,
        protocol_status: result.status,
      });
  }
}
