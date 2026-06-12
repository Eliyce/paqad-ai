import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

/** Synchronous sleep — vitest skill specs are synchronous, so no await. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * stderr text that means the *infrastructure* failed (fork pressure, pipe or
 * here-document setup), not that the script rejected its input. Such results
 * are retryable even though stderr is non-empty.
 */
const INFRA_STDERR =
  /cannot allocate memory|resource temporarily unavailable|cannot fork|cannot make pipe|here-document/i;

/**
 * Runs a bash script and captures stdout / stderr / exit status.
 * Used by every skill spec instead of mocking — tests run the real script
 * the LLM would invoke at runtime.
 *
 * Two defenses against vitest-parallelism flakes (issue #24):
 *
 * 1. `input` is delivered through a temp file opened as the child's stdin
 *    instead of a pipe. Under heavy parallel spawn load the pipe write could
 *    be lost, so a stdin-validating script saw empty input and rejected it —
 *    a "real" failure (non-zero exit, stderr written) that no retry gate can
 *    distinguish from a genuine rejection. A file-backed fd cannot be
 *    truncated by spawn races; scripts still read it as plain stdin.
 *
 * 2. Retries with escalating backoff, but only when the child produced no
 *    output at all (or infrastructure-flavored stderr). A script that printed
 *    anything ran for real — returning immediately keeps genuine rejections
 *    fast and stops expected-non-zero specs (e.g. `--help` exits 2 with usage
 *    on stdout) from burning the full backoff on every invocation.
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
    const common = {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 10_000,
    } as const;
    if (opts.input === undefined) {
      const r = spawnSync('bash', [abs, ...args], common);
      return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    }
    const dir = mkdtempSync(join(tmpdir(), 'paqad-skill-stdin-'));
    const stdinFile = join(dir, 'stdin');
    let fd: number | null = null;
    try {
      writeFileSync(stdinFile, opts.input);
      fd = openSync(stdinFile, 'r');
      const r = spawnSync('bash', [abs, ...args], { ...common, stdio: [fd, 'pipe', 'pipe'] });
      return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    } finally {
      if (fd !== null) closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const debugLog = (r: RunResult, attempt: number): void => {
    // Flake forensics: PAQAD_DEBUG_RUNSCRIPT=<path> appends every non-zero
    // result so CI flakes can be diagnosed from their real stderr.
    const target = process.env.PAQAD_DEBUG_RUNSCRIPT;
    if (!target || r.status === 0) return;
    try {
      appendFileSync(
        target,
        `${JSON.stringify({ script: abs, args, attempt, ...r })}\n`,
      );
    } catch {
      // diagnostics must never fail a test
    }
  };
  const retryable = (r: RunResult): boolean =>
    r.status !== 0 &&
    r.stdout.trim().length === 0 &&
    (r.stderr.trim().length === 0 || INFRA_STDERR.test(r.stderr));
  let attempt = 1;
  let result = invoke();
  debugLog(result, attempt);
  for (const backoffMs of [50, 150, 450]) {
    if (!retryable(result)) {
      return result;
    }
    sleepSync(backoffMs);
    attempt += 1;
    result = invoke();
    debugLog(result, attempt);
  }
  return result;
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
