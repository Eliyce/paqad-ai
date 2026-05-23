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
 *
 * Retries once on transient bash-subprocess failures. Under heavy parallel
 * CI load (vitest spawning many bash processes simultaneously), some
 * invocations exit non-zero before the script can run — we'd see status 1
 * with empty stderr and no real assertion. Scripts that *actually* reject
 * their input always write to stderr via `say` / `printf >&2`, so the
 * empty-stderr gate ensures we only retry true flakes, not real failures.
 * See https://github.com/Eliyce/paqad-ai/issues/24.
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
  const invoke = (): RunResult => {
    const r = spawnSync('bash', [abs, ...args], {
      input: opts.input,
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 10_000,
    });
    return {
      status: r.status ?? -1,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  };
  const first = invoke();
  if (first.status === 0 || first.stderr.trim().length > 0) {
    return first;
  }
  // Transient bash-subprocess failure (non-zero exit, no real stderr).
  // Brief backoff, then retry once.
  const wait = Date.now() + 50;
  while (Date.now() < wait) {
    // tight spin — vitest tests are synchronous, can't await
  }
  return invoke();
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
