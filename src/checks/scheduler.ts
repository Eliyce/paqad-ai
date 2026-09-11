// The concurrent command scheduler (issue #554, Part C). Runs the mapped check commands in three
// stages — formatters serialized first (they rewrite files), then the build and shell commands
// overlapped, then the test command alone — and records each command's stage and wall-clock
// duration. Every stage runs even after an earlier red command, so `passed` is computed at the end,
// never short-circuited. With `checks_parallel=false` it collapses to one serial pass in order.

import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import type { DeliveryShell } from '@/delivery/runner.js';

export type CommandStage = 1 | 2 | 3;

/** One command to run, pre-classified into its stage by the caller. */
export interface ScheduledCommand {
  logical_command: string | null;
  command: string;
  stage: CommandStage;
}

/** One command's outcome with timing and captured output. */
export interface ScheduledCommandResult {
  logical_command: string | null;
  command: string;
  stage: CommandStage;
  exit_code: number;
  passed: boolean;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  stdout: string;
  stderr: string;
  /** The unsupported-syntax message when the mapped command was rejected before spawning. */
  invalid?: string;
}

export interface RunStagesOptions {
  cwd: string;
  /** When false, every command runs serially in array order (today's behaviour), still timed. */
  parallel: boolean;
  availableParallelism: number;
  /** Injectable monotonic ms clock (duration) and ISO clock (timestamps) for deterministic tests. */
  nowMs?: () => number;
  nowIso?: () => string;
}

/**
 * Run the scheduled commands. Returns one result per command in input order. Stage 1 runs serially
 * in order; stage 2 runs concurrently, at most `min(stage-2 count, availableParallelism)` at once;
 * stage 3 (the test command) runs alone after stage 2. With `parallel=false` the whole set runs
 * serially in the given order.
 */
export async function runStages(
  commands: readonly ScheduledCommand[],
  shell: DeliveryShell,
  opts: RunStagesOptions,
): Promise<ScheduledCommandResult[]> {
  const nowMs = opts.nowMs ?? (() => Date.now());
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());

  const runOne = async (cmd: ScheduledCommand): Promise<ScheduledCommandResult> => {
    const started_at = nowIso();
    const startMs = nowMs();
    const finish = (
      partial: Pick<ScheduledCommandResult, 'exit_code' | 'stdout' | 'stderr' | 'invalid'>,
    ): ScheduledCommandResult => {
      const ended_at = nowIso();
      return {
        logical_command: cmd.logical_command,
        command: cmd.command,
        stage: cmd.stage,
        exit_code: partial.exit_code,
        passed: partial.exit_code === 0,
        started_at,
        ended_at,
        duration_ms: Math.max(0, nowMs() - startMs),
        stdout: partial.stdout,
        stderr: partial.stderr,
        ...(partial.invalid ? { invalid: partial.invalid } : {}),
      };
    };

    const parsed = parseCommandChain(cmd.command);
    if (!parsed.ok) {
      return finish({
        exit_code: 1,
        stdout: '',
        stderr: '',
        invalid: `Unsupported shell syntax in mapped command: ${parsed.invalidToken}`,
      });
    }
    const result = await runCommandChain(shell, parsed.steps, opts.cwd);
    return finish({ exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  };

  if (!opts.parallel) {
    const out: ScheduledCommandResult[] = [];
    for (const cmd of commands) out.push(await runOne(cmd));
    return out;
  }

  const stage1 = commands.filter((cmd) => cmd.stage === 1);
  const stage2 = commands.filter((cmd) => cmd.stage === 2);
  const stage3 = commands.filter((cmd) => cmd.stage === 3);

  const results: ScheduledCommandResult[] = [];
  for (const cmd of stage1) results.push(await runOne(cmd));
  results.push(...(await runPool(stage2, Math.min(stage2.length, opts.availableParallelism), runOne)));
  for (const cmd of stage3) results.push(await runOne(cmd));
  return results;
}

/** Run `cmds` through `runOne` with at most `limit` in flight; results keep input order. */
async function runPool<T, R>(
  cmds: readonly T[],
  limit: number,
  runOne: (cmd: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(cmds.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < cmds.length) {
      const index = next++;
      results[index] = await runOne(cmds[index]!);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, cmds.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
