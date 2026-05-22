import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  input?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Runs a bash script and captures stdout / stderr / exit status.
 * Used by every skill spec instead of mocking — tests run the real script
 * the LLM would invoke at runtime.
 */
export function runScript(
  scriptPath: string,
  args: string[] = [],
  opts: RunOptions = {},
): RunResult {
  const abs = resolve(scriptPath);
  if (!existsSync(abs)) {
    return { status: -1, stdout: '', stderr: `script not found: ${abs}` };
  }
  const result = spawnSync('bash', [abs, ...args], {
    input: opts.input,
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 10_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Returns true when `bash -n <path>` passes (syntax check; no execution).
 */
export function syntaxOk(scriptPath: string): boolean {
  const r = spawnSync('bash', ['-n', resolve(scriptPath)], { encoding: 'utf8' });
  return r.status === 0;
}

/**
 * Returns trimmed lines of stdout (filters empty trailing line).
 */
export function lines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => l.length > 0);
}
