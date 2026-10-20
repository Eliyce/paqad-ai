import { spawnSync } from 'node:child_process';
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

export function executeRuleScript(
  scriptPath: string,
  payload: ExecutePayload,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ExecuteResult {
  const proc = spawnSync('node', [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (proc.error) {
    const err = proc.error as NodeJS.ErrnoException;
    if (proc.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
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

function isOnPath(bin: string): boolean {
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
