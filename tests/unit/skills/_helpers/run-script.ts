import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';

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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const INFRA_STDERR =
  /cannot allocate memory|resource temporarily unavailable|cannot fork|cannot make pipe|here-document/i;

export function interpreterFor(scriptPath: string): string {
  const ext = extname(scriptPath);
  if (ext === '.py') return 'python3';
  if (ext === '.mjs' || ext === '.js') return process.execPath;
  return 'bash';
}

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
    const r = spawnSync(interpreterFor(abs), [abs, ...args], {
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
  const debugLog = (r: RunResult, attempt: number): void => {
    const target = process.env.PAQAD_DEBUG_RUNSCRIPT;
    if (!target || r.status === 0) return;
    try {
      appendFileSync(target, `${JSON.stringify({ script: abs, args, attempt, ...r })}\n`);
    } catch {}
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

export function syntaxOk(scriptPath: string): boolean {
  const r = spawnSync('bash', ['-n', resolve(scriptPath)], { encoding: 'utf8' });
  return r.status === 0;
}

export function lines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => l.length > 0);
}
