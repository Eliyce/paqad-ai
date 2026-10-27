import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { DEFAULT_SOURCE_GLOBS, scanWorkingTree } from '@/core/fs/gitignore-scan.js';
import { runPool } from '@/core/run-pool.js';
import { writeFileAtomic } from '@/hud/files.js';

import {
  executeRuleScript,
  executeRuleScriptAsync,
  missingBinaries,
  type ExecuteResult,
  type Finding,
} from './execute.js';
import { openFileResultsCache, sha256Text, type FileResultsCache } from './file-cache.js';
import { parseScriptHeader } from './header.js';
import { loadRuleScriptMap } from './map.js';
import { appendRuleRun, type RuleRunFinding } from '@/feature-evidence/bundle-ledgers.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { RuleEntry, RuleScriptMap, ScriptEntry } from './types.js';

export type RuleComplianceMode = 'off' | 'warn' | 'strict';

export interface ScriptRunResult {
  rule_id: string;
  script: string;
  kind: 'deterministic' | 'heuristic';
  findings: Finding[];
  skipped?: string;
  warning?: string;
}

export interface RunFilter {
  kinds?: RuleScriptKind[];
  scopes?: RuleScriptScope[];
}

export interface RunReport {
  generated_at: string;
  mode: RuleComplianceMode;
  rule_files_hash: string;
  script_files_hash: string;
  target_files_hash: string;
  filter?: RunFilter;
  results: ScriptRunResult[];
  counts: { deterministic: number; heuristic: number; skipped: number };
  blocking: boolean;
  from_cache?: boolean;
  aborted?: boolean;
}

export type RuleScriptKind = 'deterministic' | 'heuristic';
export type RuleScriptScope = 'changed-files' | 'whole-tree';

export interface RunOptions {
  projectRoot: string;
  mode: RuleComplianceMode;
  changedFiles?: string[];
  wholeTreeGlobs?: string[];
  kinds?: RuleScriptKind[];
  scopes?: RuleScriptScope[];
}

export interface RunAsyncOptions extends RunOptions {
  concurrency?: number;
  signal?: AbortSignal;
  useFileCache?: boolean;
  scriptTimeoutMs?: number;
}

function hashFiles(projectRoot: string, files: string[]): string {
  const parts = files
    .slice()
    .sort()
    .map((rel) => {
      const abs = join(projectRoot, rel);
      return existsSync(abs) ? `${rel}\n${readFileSync(abs, 'utf8')}` : `${rel}\n<absent>`;
    });
  return `sha256-${sha256Text(parts.join('\n'))}`;
}

export function scriptFilesHash(projectRoot: string, map: RuleScriptMap): string {
  const paths = map.rules.flatMap((r) => r.scripts.map((s) => s.path)).sort();
  return hashFiles(projectRoot, paths);
}

interface SelectedScript {
  rule: RuleEntry;
  script: ScriptEntry;
}

interface ScriptJob extends SelectedScript {
  index: number;
  scriptAbs: string;
  scriptSha: string;
  perFile: boolean;
  targets: string[];
}

interface PreparedRun {
  now: string;
  map: RuleScriptMap;
  filter: RunFilter | undefined;
  scriptHash: string;
  targetHash: string;
  reportFile: string;
  slots: Array<ScriptRunResult | ScriptJob>;
}

type Preparation = { done: RunReport } | { run: PreparedRun };

function runFilter(opts: RunOptions): RunFilter | undefined {
  if (opts.kinds === undefined && opts.scopes === undefined) {
    return undefined;
  }
  return {
    ...(opts.kinds ? { kinds: [...opts.kinds] } : {}),
    ...(opts.scopes ? { scopes: [...opts.scopes] } : {}),
  };
}

function selectScripts(map: RuleScriptMap, filter: RunFilter | undefined): SelectedScript[] {
  return map.rules.flatMap((rule) =>
    rule.scripts
      .filter(
        (script) =>
          (filter?.kinds === undefined || filter.kinds.includes(script.kind)) &&
          (filter?.scopes === undefined || (filter.scopes as string[]).includes(script.scope)),
      )
      .map((script) => ({ rule, script })),
  );
}

function selectedScriptsHash(
  projectRoot: string,
  map: RuleScriptMap,
  selected: SelectedScript[],
  filter: RunFilter | undefined,
): string {
  if (filter === undefined) {
    return scriptFilesHash(projectRoot, map);
  }
  return hashFiles(
    projectRoot,
    selected.map((entry) => entry.script.path),
  );
}

function emptyReport(opts: RunOptions, now: string): RunReport {
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

function skippedResult(entry: SelectedScript, skipped: string): ScriptRunResult {
  return {
    rule_id: entry.rule.id,
    script: entry.script.path,
    kind: entry.script.kind,
    findings: [],
    skipped,
  };
}

function prepareRun(opts: RunOptions): Preparation {
  const map = loadRuleScriptMap(opts.projectRoot);
  const now = new Date().toISOString();
  if (!map) {
    return { done: emptyReport(opts, now) };
  }

  const filter = runFilter(opts);
  const selected = selectScripts(map, filter);
  const needsTree =
    opts.changedFiles === undefined ||
    selected.some((entry) => entry.script.scope !== 'changed-files');
  const wholeTreeFiles = needsTree
    ? scanWorkingTree(opts.projectRoot, opts.wholeTreeGlobs ?? DEFAULT_SOURCE_GLOBS)
    : [];
  const targetUniverse =
    opts.changedFiles === undefined
      ? wholeTreeFiles
      : needsTree
        ? Array.from(new Set([...opts.changedFiles, ...wholeTreeFiles]))
        : opts.changedFiles;
  const scriptHash = selectedScriptsHash(opts.projectRoot, map, selected, filter);
  const targetHash = hashFiles(opts.projectRoot, targetUniverse);
  const reportFile =
    filter === undefined ? PATHS.RULE_SCRIPTS_REPORT : PATHS.RULE_SCRIPTS_PRE_MUTATION_REPORT;

  const cached = readReportFile(opts.projectRoot, reportFile);
  if (
    cached &&
    cached.mode === opts.mode &&
    cached.rule_files_hash === map.rule_files_hash &&
    cached.script_files_hash === scriptHash &&
    cached.target_files_hash === targetHash &&
    JSON.stringify(cached.filter) === JSON.stringify(filter)
  ) {
    recordRuleRun(opts.projectRoot, cached, true);
    return { done: { ...cached, from_cache: true } };
  }

  const slots = selected.map((entry, index): ScriptRunResult | ScriptJob => {
    const scriptAbs = join(opts.projectRoot, entry.script.path);
    if (!existsSync(scriptAbs)) {
      return skippedResult(entry, 'script-file-missing');
    }
    const source = readFileSync(scriptAbs, 'utf8');
    const header = parseScriptHeader(source);
    const missing = missingBinaries(header.header?.requires?.binaries);
    if (missing.length > 0) {
      return skippedResult(entry, `missing dependency: ${missing.join(', ')}`);
    }
    const targets =
      entry.script.scope === 'changed-files' && opts.changedFiles
        ? opts.changedFiles
        : wholeTreeFiles;
    return {
      ...entry,
      index,
      scriptAbs,
      scriptSha: sha256Text(source),
      perFile: header.header?.per_file === true,
      targets,
    };
  });

  return {
    run: {
      now,
      map,
      filter,
      scriptHash,
      targetHash,
      reportFile,
      slots,
    },
  };
}

function isJob(slot: ScriptRunResult | ScriptJob): slot is ScriptJob {
  return 'scriptAbs' in slot;
}

function resultFor(job: ScriptJob, run: ExecuteResult): ScriptRunResult {
  if (!run.ok) {
    return skippedResult(job, `error: ${run.error}`);
  }
  return {
    rule_id: job.rule.id,
    script: job.script.path,
    kind: job.script.kind,
    findings: run.report?.findings ?? [],
    ...(run.warning ? { warning: run.warning } : {}),
  };
}

function finishRun(opts: RunOptions, prepared: PreparedRun, results: ScriptRunResult[]): RunReport {
  const deterministic = results
    .filter((r) => r.kind === 'deterministic' && !r.skipped)
    .reduce((n, r) => n + r.findings.length, 0);
  const heuristic = results
    .filter((r) => r.kind === 'heuristic' && !r.skipped)
    .reduce((n, r) => n + r.findings.length, 0);
  const skipped = results.filter((r) => r.skipped).length;

  const report: RunReport = {
    generated_at: prepared.now,
    mode: opts.mode,
    rule_files_hash: prepared.map.rule_files_hash,
    script_files_hash: prepared.scriptHash,
    target_files_hash: prepared.targetHash,
    ...(prepared.filter ? { filter: prepared.filter } : {}),
    results,
    counts: { deterministic, heuristic, skipped },
    blocking: opts.mode === 'strict' && deterministic > 0,
  };

  writeReport(opts.projectRoot, prepared.reportFile, report);
  recordRuleRun(opts.projectRoot, report, false);
  return report;
}

export function runRuleScripts(opts: RunOptions): RunReport {
  const prepared = prepareRun(opts);
  if ('done' in prepared) {
    return prepared.done;
  }
  const results = prepared.run.slots.map((slot) =>
    isJob(slot)
      ? resultFor(
          slot,
          executeRuleScript(slot.scriptAbs, {
            projectRoot: opts.projectRoot,
            files: slot.targets,
          }),
        )
      : slot,
  );
  return finishRun(opts, prepared.run, results);
}

function mergeFileFindings(
  job: ScriptJob,
  cached: Map<string, Finding[]>,
  fresh: Finding[],
): Finding[] {
  const targets = new Set(job.targets);
  return [
    ...job.targets.flatMap(
      (file) => cached.get(file) ?? fresh.filter((finding) => finding.file === file),
    ),
    ...fresh.filter((finding) => !targets.has(finding.file)),
  ];
}

async function runPerFileJob(
  job: ScriptJob,
  cache: FileResultsCache,
  opts: RunAsyncOptions,
): Promise<ScriptRunResult> {
  const cached = new Map<string, Finding[]>();
  const dirty: string[] = [];
  for (const file of job.targets) {
    const hit = cache.lookup(job.script.path, job.scriptSha, file);
    if (hit) cached.set(file, hit);
    else dirty.push(file);
  }
  if (dirty.length === 0) {
    return resultFor(job, {
      ok: true,
      report: {
        rule_id: job.rule.id,
        kind: job.script.kind,
        findings: mergeFileFindings(job, cached, []),
      },
    });
  }
  const run = await executeRuleScriptAsync(
    job.scriptAbs,
    { projectRoot: opts.projectRoot, files: dirty },
    { signal: opts.signal, timeoutMs: opts.scriptTimeoutMs },
  );
  if (!run.ok || !run.report) {
    return resultFor(job, run);
  }
  const fresh = run.report.findings;
  const dirtySet = new Set(dirty);
  if (fresh.every((finding) => dirtySet.has(finding.file))) {
    for (const file of dirty) {
      cache.store(
        job.script.path,
        job.scriptSha,
        file,
        fresh.filter((finding) => finding.file === file),
      );
    }
  }
  return resultFor(job, {
    ...run,
    report: { ...run.report, findings: mergeFileFindings(job, cached, fresh) },
  });
}

export async function runRuleScriptsAsync(opts: RunAsyncOptions): Promise<RunReport> {
  const prepared = prepareRun(opts);
  if ('done' in prepared) {
    return prepared.done;
  }
  const cache = opts.useFileCache ? openFileResultsCache(opts.projectRoot) : null;
  const results = await runPool(prepared.run.slots, opts.concurrency ?? 1, async (slot) => {
    if (!isJob(slot)) return slot;
    if (cache && slot.perFile) return runPerFileJob(slot, cache, opts);
    return resultFor(
      slot,
      await executeRuleScriptAsync(
        slot.scriptAbs,
        { projectRoot: opts.projectRoot, files: slot.targets },
        { signal: opts.signal, timeoutMs: opts.scriptTimeoutMs },
      ),
    );
  });
  cache?.save();
  if (opts.signal?.aborted) {
    return { ...emptyReport(opts, prepared.run.now), results, aborted: true };
  }
  return finishRun(opts, prepared.run, results);
}

export function ruleRunFindings(report: RunReport): RuleRunFinding[] | undefined {
  if (!Array.isArray(report.results)) return undefined;
  return report.results
    .filter((result) => !result.skipped)
    .flatMap((result) =>
      result.findings.map((finding) => ({
        rule_id: result.rule_id,
        file: finding.file,
        line: finding.line ?? null,
        message: finding.message,
        severity: finding.severity,
      })),
    );
}

function recordRuleRun(projectRoot: string, report: RunReport, fromCache: boolean): void {
  appendRuleRun(
    projectRoot,
    resolveSessionId(projectRoot, process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null),
    {
      kind: 'findings',
      counts: report.counts,
      blocking: report.blocking,
      findings: ruleRunFindings(report),
      from_cache: fromCache,
    },
  );
}

export function readReport(projectRoot: string): RunReport | null {
  return readReportFile(projectRoot, PATHS.RULE_SCRIPTS_REPORT);
}

function readReportFile(projectRoot: string, reportFile: string): RunReport | null {
  const path = join(projectRoot, reportFile);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RunReport;
  } catch {
    return null;
  }
}

function writeReport(projectRoot: string, reportFile: string, report: RunReport): void {
  writeFileAtomic(join(projectRoot, reportFile), `${JSON.stringify(report, null, 2)}\n`);
}
