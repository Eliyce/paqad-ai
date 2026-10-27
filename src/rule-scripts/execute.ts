import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { validateFindings } from './validate.js';

export interface ExecutePayload {
  projectRoot: string;
  files: string[];
}

export interface Finding {
  file: string;
  line?: number;
  message: string;
  severity: 'critical' | 'blocker' | 'high' | 'medium' | 'low' | 'nit' | 'info';
}

export interface FindingsReport {
  rule_id: string;
  kind: 'deterministic' | 'heuristic';
  findings: Finding[];
}

export interface ExecuteResult {
  ok: boolean;
  report?: FindingsReport;
  error?: string;
  warning?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export const SCRIPT_ABORTED_ERROR = 'script stopped: the rule gate ran out of time';

interface ProcessOutcome {
  error?: { code?: string; message: string };
  signal: NodeJS.Signals | null;
  status: number | null;
  stdout: string;
  stderr: string;
}

export function executeRuleScript(
  scriptPath: string,
  payload: ExecutePayload,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ExecuteResult {
  const proc = spawnSync('node', [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const error = proc.error as NodeJS.ErrnoException | undefined;
  return interpretOutcome(
    {
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
      signal: proc.signal,
      status: proc.status,
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
    timeoutMs,
  );
}

export interface ExecuteAsyncOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function executeRuleScriptAsync(
  scriptPath: string,
  payload: ExecutePayload,
  options: ExecuteAsyncOptions = {},
): Promise<ExecuteResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (options.signal?.aborted) {
    return Promise.resolve({ ok: false, error: SCRIPT_ABORTED_ERROR });
  }
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const sizes = { stdout: 0, stderr: 0 };
    let forced: ProcessOutcome['error'];
    let aborted = false;
    let settled = false;

    const stop = (error: ProcessOutcome['error']): void => {
      if (forced || aborted) return;
      forced = error;
      child.kill('SIGTERM');
    };
    const timer = setTimeout(
      () => stop({ code: 'ETIMEDOUT', message: 'spawn node ETIMEDOUT' }),
      timeoutMs,
    );
    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const collect = (stream: 'stdout' | 'stderr', sink: Buffer[]) => (chunk: Buffer) => {
      sizes[stream] += chunk.length;
      sink.push(chunk);
      if (sizes[stream] > MAX_OUTPUT_BYTES) {
        stop({ code: 'ENOBUFS', message: 'spawn node ENOBUFS' });
      }
    };
    child.stdout.on('data', collect('stdout', stdout));
    child.stderr.on('data', collect('stderr', stderr));

    const finish = (outcome: ProcessOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(
        aborted ? { ok: false, error: SCRIPT_ABORTED_ERROR } : interpretOutcome(outcome, timeoutMs),
      );
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        error: { code: error.code, message: error.message },
        signal: null,
        status: null,
        stdout: '',
        stderr: '',
      });
    });
    child.on('close', (status, signal) => {
      finish({
        ...(forced ? { error: forced } : {}),
        signal: forced ? 'SIGTERM' : signal,
        status: forced ? null : status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stop({ code: error.code, message: error.message });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function interpretOutcome(proc: ProcessOutcome, timeoutMs: number): ExecuteResult {
  if (proc.error) {
    if (proc.signal === 'SIGTERM' || proc.error.code === 'ETIMEDOUT') {
      return { ok: false, error: `script timed out after ${timeoutMs}ms` };
    }
    return { ok: false, error: `script failed to start: ${proc.error.message}` };
  }
  if (proc.signal) {
    return { ok: false, error: `script killed by signal ${proc.signal}` };
  }

  let parsed: unknown;
  let parseFailed = false;
  try {
    parsed = JSON.parse(proc.stdout);
  } catch {
    parseFailed = true;
  }

  if (!parseFailed) {
    const validation = validateFindings(parsed);
    if (validation.valid) {
      const stderr = (proc.stderr || '').trim();
      const warning =
        proc.status !== 0
          ? `script exited ${proc.status}${stderr ? `: ${stderr}` : ''}`
          : stderr || undefined;
      return warning
        ? { ok: true, report: parsed as FindingsReport, warning }
        : { ok: true, report: parsed as FindingsReport };
    }
    if (proc.status === 0) {
      return { ok: false, error: `findings failed schema: ${validation.errors.join('; ')}` };
    }
  }

  if (proc.status !== 0) {
    const stderr = (proc.stderr || '').trim();
    return {
      ok: false,
      error: `script exited ${proc.status}${stderr ? `: ${stderr}` : ' with no parseable findings'}`,
    };
  }

  return { ok: false, error: `invalid findings JSON on stdout: ${proc.stdout.slice(0, 200)}` };
}

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) {
      return false;
    }
  } catch {
    return false;
  }
  if (process.platform === 'win32') {
    return true;
  }
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isOnPath(bin: string): boolean {
  if (bin.includes('/') || bin.includes('\\')) {
    return isExecutableFile(bin);
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const winExts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [];
  const alreadyHasExt =
    process.platform === 'win32' &&
    winExts.some((ext) => bin.toLowerCase().endsWith(ext.toLowerCase()));
  const exts = process.platform === 'win32' ? (alreadyHasExt ? [''] : winExts) : [''];
  return dirs.some((dir) => exts.some((ext) => isExecutableFile(join(dir, `${bin}${ext}`))));
}

export function missingBinaries(binaries: string[] | undefined): string[] {
  if (!binaries || binaries.length === 0) {
    return [];
  }
  return binaries.filter((bin) => !isOnPath(bin));
}
