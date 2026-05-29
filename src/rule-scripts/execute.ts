// Execute a single rule script and parse its findings (issue #89).
//
// Contract for every generated .mjs:
//   - invoked as `node <script>` with no args;
//   - reads a JSON payload { projectRoot, files } from stdin;
//   - writes a findings report (schemas/findings.schema.json) to stdout.
//
// Scripts are sandboxed only by convention; they are framework- or
// LLM-generated and reviewed in PRs. Execution is synchronous and bounded by a
// timeout so a runaway script cannot wedge the checks stage.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { validateFindings } from './validate.js';

export interface ExecutePayload {
  projectRoot: string;
  // Project-relative paths the script should inspect.
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
    // spawn-level failure: process never started (ENOENT) or was killed.
    const err = proc.error as NodeJS.ErrnoException;
    if (proc.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      return { ok: false, error: `script timed out after ${timeoutMs}ms` };
    }
    return { ok: false, error: `script failed to start: ${proc.error.message}` };
  }
  if (proc.signal) {
    return { ok: false, error: `script killed by signal ${proc.signal}` };
  }

  // Parse stdout BEFORE judging the exit code. The contract is "exit 0, signal
  // via JSON", but a common linter convention is to exit non-zero when findings
  // exist — so if stdout is a valid findings report, honour it regardless of
  // the exit code rather than discarding real findings as an error.
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
      return { ok: true, report: parsed as FindingsReport };
    }
    // Parsed but not a findings report. If the script also failed, the exit is
    // the more useful error; otherwise report the schema mismatch.
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

// Resolve a binary against PATH directly in Node — no subprocess (the old
// `command -v` / `where` spawn was ENOENT on Linux, where `command` is a shell
// builtin, not a binary). Cross-platform and injection-safe.
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
  // Names with a path separator are resolved as-is, not against PATH.
  if (bin.includes('/') || bin.includes('\\')) {
    return isExecutableFile(bin);
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const winExts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [];
  // On Windows, a name that already carries a known executable extension is
  // resolved bare (don't build `git.exe.EXE`); otherwise try each PATHEXT.
  const alreadyHasExt =
    process.platform === 'win32' &&
    winExts.some((ext) => bin.toLowerCase().endsWith(ext.toLowerCase()));
  const exts = process.platform === 'win32' ? (alreadyHasExt ? [''] : winExts) : [''];
  return dirs.some((dir) => exts.some((ext) => isExecutableFile(join(dir, `${bin}${ext}`))));
}

// Returns the subset of declared binaries that are not resolvable on PATH.
export function missingBinaries(binaries: string[] | undefined): string[] {
  if (!binaries || binaries.length === 0) {
    return [];
  }
  return binaries.filter((bin) => !isOnPath(bin));
}
