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
import { existsSync } from 'node:fs';
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
    return { ok: false, error: `failed to execute: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    return {
      ok: false,
      error: `script exited ${proc.status ?? 'null'}: ${(proc.stderr || '').trim()}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(proc.stdout);
  } catch {
    return { ok: false, error: `invalid findings JSON on stdout: ${proc.stdout.slice(0, 200)}` };
  }

  const validation = validateFindings(parsed);
  if (!validation.valid) {
    return { ok: false, error: `findings failed schema: ${validation.errors.join('; ')}` };
  }

  return { ok: true, report: parsed as FindingsReport };
}

// Resolve a binary against PATH directly in Node — no subprocess (the old
// `command -v` / `where` spawn was ENOENT on Linux, where `command` is a shell
// builtin, not a binary). Cross-platform and injection-safe.
function isOnPath(bin: string): boolean {
  // Names with path separators are resolved relative to cwd as-is.
  if (bin.includes('/') || bin.includes('\\')) {
    return existsSync(bin);
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  return dirs.some((dir) => exts.some((ext) => existsSync(join(dir, `${bin}${ext}`))));
}

// Returns the subset of declared binaries that are not resolvable on PATH.
export function missingBinaries(binaries: string[] | undefined): string[] {
  if (!binaries || binaries.length === 0) {
    return [];
  }
  return binaries.filter((bin) => !isOnPath(bin));
}
