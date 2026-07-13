// Execute registered rule scripts and aggregate findings (issue #89, Phase 3).
//
// No LLM. Invoked from feature-development.checks via the bundled
// rule-script-runner skill. Diff-scoped by default; hash-cached like
// src/compliance/compliance-checker.ts (rule_files_hash × script_files_hash ×
// target_files_hash). Mode semantics:
//   off    — caller skips the runner entirely.
//   warn   — run, write the report, never block.
//   strict — run, block on any `deterministic` finding. `heuristic` never blocks.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { DEFAULT_SOURCE_GLOBS, scanWorkingTree } from '@/core/fs/gitignore-scan.js';

import { executeRuleScript, missingBinaries, type Finding } from './execute.js';
import { parseScriptHeader } from './header.js';
import { loadRuleScriptMap } from './map.js';
import { recordRuleFindings } from './rule-ledger.js';
import { appendRuleRun } from '@/feature-evidence/bundle-ledgers.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { RuleScriptMap, ScriptEntry } from './types.js';

export type RuleComplianceMode = 'off' | 'warn' | 'strict';

export interface ScriptRunResult {
  rule_id: string;
  script: string;
  kind: 'deterministic' | 'heuristic';
  findings: Finding[];
  skipped?: string;
  // Non-fatal diagnostic when the script produced findings but also signalled a
  // problem (non-zero exit / stderr) — see execute.ts (D-6).
  warning?: string;
}

export interface RunReport {
  generated_at: string;
  mode: RuleComplianceMode;
  rule_files_hash: string;
  script_files_hash: string;
  target_files_hash: string;
  results: ScriptRunResult[];
  counts: { deterministic: number; heuristic: number; skipped: number };
  blocking: boolean;
  from_cache?: boolean;
}

export interface RunOptions {
  projectRoot: string;
  mode: RuleComplianceMode;
  // Project-relative changed files for `changed-files`-scoped scripts. When
  // omitted, changed-files scripts fall back to whole-tree enumeration.
  changedFiles?: string[];
  // Globs for whole-tree enumeration. Defaults to common source extensions.
  wholeTreeGlobs?: string[];
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hashFiles(projectRoot: string, files: string[]): string {
  const parts = files
    .slice()
    .sort()
    .map((rel) => {
      const abs = join(projectRoot, rel);
      return existsSync(abs) ? `${rel}\n${readFileSync(abs, 'utf8')}` : `${rel}\n<absent>`;
    });
  return `sha256-${sha256(parts.join('\n'))}`;
}

export function scriptFilesHash(projectRoot: string, map: RuleScriptMap): string {
  const paths = map.rules.flatMap((r) => r.scripts.map((s) => s.path)).sort();
  return hashFiles(projectRoot, paths);
}

function targetsFor(script: ScriptEntry, opts: RunOptions, wholeTreeFiles: string[]): string[] {
  if (script.scope === 'changed-files' && opts.changedFiles) {
    return opts.changedFiles;
  }
  // whole-tree, git-diff, git-history, or changed-files with no diff provided.
  return wholeTreeFiles;
}

function reportPath(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPTS_REPORT);
}

export function runRuleScripts(opts: RunOptions): RunReport {
  const map = loadRuleScriptMap(opts.projectRoot);
  const now = new Date().toISOString();

  if (!map) {
    return {
      generated_at: now,
      mode: opts.mode,
      rule_files_hash: '',
      script_files_hash: '',
      target_files_hash: '',
      results: [],
      counts: { deterministic: 0, heuristic: 0, skipped: 0 },
      blocking: false,
    };
  }

  const globs = opts.wholeTreeGlobs ?? DEFAULT_SOURCE_GLOBS;
  const wholeTreeFiles = scanWorkingTree(opts.projectRoot, globs);
  // The cache key must hash every file any registered script can actually read.
  // A `changed-files` run still scans the whole tree for whole-tree/git-scoped
  // scripts, so when any such script exists those files belong in the target
  // hash too — otherwise an unrelated tree mutation returns a stale cached
  // result for them.
  const hasNonChangedScope = map.rules.some((r) =>
    r.scripts.some((s) => s.scope !== 'changed-files'),
  );
  const targetUniverse =
    opts.changedFiles === undefined
      ? wholeTreeFiles
      : hasNonChangedScope
        ? Array.from(new Set([...opts.changedFiles, ...wholeTreeFiles]))
        : opts.changedFiles;
  const scriptHash = scriptFilesHash(opts.projectRoot, map);
  const targetHash = hashFiles(opts.projectRoot, targetUniverse);

  // Hash-cache: a prior report with matching triple is still valid. rule_files_hash
  // is the analyze-time snapshot from the map (not re-derived here) — rule-file
  // edits surface separately as RS-* drift via the reconciler.
  const cached = readReport(opts.projectRoot);
  if (
    cached &&
    cached.mode === opts.mode &&
    cached.rule_files_hash === map.rule_files_hash &&
    cached.script_files_hash === scriptHash &&
    cached.target_files_hash === targetHash
  ) {
    return { ...cached, from_cache: true };
  }

  const results: ScriptRunResult[] = [];
  for (const rule of map.rules) {
    for (const script of rule.scripts) {
      const scriptAbs = join(opts.projectRoot, script.path);
      if (!existsSync(scriptAbs)) {
        results.push({
          rule_id: rule.id,
          script: script.path,
          kind: script.kind,
          findings: [],
          skipped: 'script-file-missing',
        });
        continue;
      }
      const header = parseScriptHeader(readFileSync(scriptAbs, 'utf8'));
      const missing = missingBinaries(header.header?.requires?.binaries);
      if (missing.length > 0) {
        results.push({
          rule_id: rule.id,
          script: script.path,
          kind: script.kind,
          findings: [],
          skipped: `missing dependency: ${missing.join(', ')}`,
        });
        continue;
      }
      const targets = targetsFor(script, opts, wholeTreeFiles);
      const run = executeRuleScript(scriptAbs, { projectRoot: opts.projectRoot, files: targets });
      if (!run.ok) {
        results.push({
          rule_id: rule.id,
          script: script.path,
          kind: script.kind,
          findings: [],
          skipped: `error: ${run.error}`,
        });
        continue;
      }
      results.push({
        rule_id: rule.id,
        script: script.path,
        kind: script.kind,
        findings: run.report?.findings ?? [],
        ...(run.warning ? { warning: run.warning } : {}),
      });
    }
  }

  const deterministic = results
    .filter((r) => r.kind === 'deterministic' && !r.skipped)
    .reduce((n, r) => n + r.findings.length, 0);
  const heuristic = results
    .filter((r) => r.kind === 'heuristic' && !r.skipped)
    .reduce((n, r) => n + r.findings.length, 0);
  const skipped = results.filter((r) => r.skipped).length;

  const report: RunReport = {
    generated_at: now,
    mode: opts.mode,
    rule_files_hash: map.rule_files_hash,
    script_files_hash: scriptHash,
    target_files_hash: targetHash,
    results,
    counts: { deterministic, heuristic, skipped },
    blocking: opts.mode === 'strict' && deterministic > 0,
  };

  writeReport(opts.projectRoot, report);
  // Evidence sink (buildout F6) — record the finding counts on the session-ledger
  // so the dashboard + SIEM fold-view read them there. report.json stays as the
  // engine's hash-cache. Only fresh runs reach here (a cache hit returned above),
  // so the latest row always reflects the latest real run.
  recordRuleFindings(opts.projectRoot, { counts: report.counts, blocking: report.blocking });
  // Issue #339 — also record which rules fired on THIS change in the active feature's
  // `rule-run.jsonl` bundle file (a no-op when no feature is active). Best-effort and
  // additive: the project-scoped rule-ledger row above is untouched.
  appendRuleRun(
    opts.projectRoot,
    resolveSessionId(
      opts.projectRoot,
      process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
    ),
    { kind: 'findings', counts: report.counts, blocking: report.blocking },
  );
  return report;
}

export function readReport(projectRoot: string): RunReport | null {
  const path = reportPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RunReport;
  } catch {
    return null;
  }
}

function writeReport(projectRoot: string, report: RunReport): void {
  const path = reportPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
