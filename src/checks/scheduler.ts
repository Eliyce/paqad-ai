import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import { runPool } from '@/core/run-pool.js';
import type { DeliveryShell } from '@/delivery/runner.js';

export type CommandStage = 1 | 2 | 3;

export interface ScheduledCommand {
  logical_command: string | null;
  command: string;
  stage: CommandStage;
}

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
  invalid?: string;
}

export interface RunStagesOptions {
  cwd: string;
  parallel: boolean;
  availableParallelism: number;
  nowMs?: () => number;
  nowIso?: () => string;
}

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
  results.push(
    ...(await runPool(stage2, Math.min(stage2.length, opts.availableParallelism), runOne)),
  );
  for (const cmd of stage3) results.push(await runOne(cmd));
  return results;
}
