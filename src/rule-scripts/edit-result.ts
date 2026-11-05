import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { runPool } from '@/core/run-pool.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';

import { editedContent } from './edited-content.js';
import { projectRelativeTargets, type RuleViolation } from './enforce.js';
import { executeRuleScriptAsync, missingBinaries, type Finding } from './execute.js';
import { parseScriptHeader } from './header.js';
import { loadRuleScriptMap } from './map.js';

const RULE_SOURCES_PREFIX = 'docs/instructions/rules/';
const MAX_GROWN_RESULT_BYTES = 1024 * 1024;
const REWRITE_NOT_THROUGH_LINK =
  constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;

export interface EditResultInput {
  projectRoot: string;
  targets: readonly string[];
  toolName: string | undefined;
  toolInput: unknown;
  violations: readonly RuleViolation[];
  concurrency: number;
  signal: AbortSignal;
}

export type EditResultVerdict =
  | { allowed: false; reason: string | null }
  | { allowed: true; target: string; removed: RuleViolation[]; remaining: number };

const NOT_A_CANDIDATE: EditResultVerdict = { allowed: false, reason: null };

interface RerunScript {
  ruleId: string;
  path: string;
  abs: string;
  perFile: boolean;
}

interface EditedTarget {
  rel: string;
  current: string;
  after: string;
}

type ScriptFinding = Finding & { script: string; rule_id: string };

function refuse(reason: string): EditResultVerdict {
  return { allowed: false, reason };
}

function spelledAsOnDisk(projectRoot: string, rel: string): boolean {
  let dir = projectRoot;
  return rel.split('/').every((segment) => {
    const found = readdirSync(dir).includes(segment);
    dir = join(dir, segment);
    return found;
  });
}

function isRegularFileInProject(projectRoot: string, rel: string): boolean {
  const abs = join(projectRoot, rel);
  return (
    lstatSync(abs).isFile() &&
    realpathSync(abs) === join(realpathSync(projectRoot), rel) &&
    spelledAsOnDisk(projectRoot, rel)
  );
}

function resultSizeAllowed(current: string, after: string): boolean {
  const size = Buffer.byteLength(after);
  return size <= MAX_GROWN_RESULT_BYTES || size <= Buffer.byteLength(current);
}

function readEditedTarget(
  input: EditResultInput,
  rel: string,
): { target: EditedTarget } | { reason: string } {
  if (!isRegularFileInProject(input.projectRoot, rel)) {
    return { reason: 'the target is not a plain file inside the project' };
  }
  const current = readFileSync(join(input.projectRoot, rel), 'utf8');
  const after = editedContent(input.toolName, input.toolInput, current);
  if (after === null) return { reason: 'the result of this edit could not be worked out' };
  if (!resultSizeAllowed(current, after)) return { reason: 'the result of this edit is too large' };
  return { target: { rel, current, after } };
}

function rerunScripts(projectRoot: string): RerunScript[] | null {
  const scripts: RerunScript[] = [];
  for (const rule of loadRuleScriptMap(projectRoot)?.rules ?? []) {
    for (const script of rule.scripts) {
      if (script.kind !== 'deterministic' || script.scope !== 'changed-files') continue;
      const abs = join(projectRoot, script.path);
      let source: string;
      try {
        source = readFileSync(abs, 'utf8');
      } catch {
        return null;
      }
      const { header } = parseScriptHeader(source);
      if (missingBinaries(header?.requires?.binaries).length > 0) return null;
      scripts.push({
        ruleId: rule.id,
        path: script.path,
        abs,
        perFile: header?.per_file === true,
      });
    }
  }
  return scripts;
}

function buildOverlay(projectRoot: string, rel: string, overlay: string): void {
  const segments = rel.split('/');
  let from = projectRoot;
  let to = overlay;
  segments.forEach((segment, index) => {
    for (const name of readdirSync(from)) {
      if (name !== segment) symlinkSync(join(from, name), join(to, name));
    }
    from = join(from, segment);
    to = join(to, segment);
    if (index < segments.length - 1) mkdirSync(to);
  });
}

function rewriteNotThroughLink(path: string, content: string): void {
  const file = openSync(path, REWRITE_NOT_THROUGH_LINK);
  try {
    writeFileSync(file, content, 'utf8');
  } finally {
    closeSync(file);
  }
}

async function scanOverlay(
  overlay: string,
  scripts: readonly RerunScript[],
  target: string,
  changedFiles: readonly string[],
  input: EditResultInput,
): Promise<ScriptFinding[] | null> {
  const runs = await runPool(scripts, input.concurrency, (script) =>
    executeRuleScriptAsync(
      script.abs,
      { projectRoot: overlay, files: script.perFile ? [target] : [...changedFiles] },
      { signal: input.signal },
    ),
  );
  if (runs.some((run) => !run.ok || !run.report)) return null;
  return runs.flatMap((run, index) =>
    (run.report?.findings ?? []).map((finding) => ({
      ...finding,
      script: scripts[index]!.path,
      rule_id: scripts[index]!.ruleId,
    })),
  );
}

function counts(keys: readonly string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const key of keys) tally.set(key, (tally.get(key) ?? 0) + 1);
  return tally;
}

function sameCounts(left: readonly string[], right: readonly string[]): boolean {
  const a = counts(left);
  const b = counts(right);
  return a.size === b.size && [...a].every(([key, count]) => b.get(key) === count);
}

function exactKey(finding: ScriptFinding | RuleViolation): string {
  return JSON.stringify([
    finding.script,
    finding.rule_id,
    finding.file,
    finding.line ?? null,
    finding.message,
    finding.severity,
  ]);
}

function comparableKey(finding: ScriptFinding, target: EditedTarget, content: string): string {
  const onTarget = finding.file === target.rel;
  const where =
    onTarget && finding.line !== undefined
      ? (content.split('\n')[finding.line - 1] ?? '')
      : (finding.line ?? null);
  return JSON.stringify([
    finding.script,
    finding.rule_id,
    finding.file,
    where,
    finding.message,
    finding.severity,
  ]);
}

function matchesRealRun(
  baseline: readonly ScriptFinding[],
  scripts: readonly RerunScript[],
  target: string,
  violations: readonly RuleViolation[],
): boolean {
  const byPath = new Map(scripts.map((script) => [script.path, script]));
  const rerun = violations.filter((violation) => {
    const script = byPath.get(violation.script);
    return script !== undefined && (!script.perFile || violation.file === target);
  });
  return sameCounts(baseline.map(exactKey), rerun.map(exactKey));
}

function compareResults(
  baseline: readonly ScriptFinding[],
  after: readonly ScriptFinding[],
  target: EditedTarget,
): { removed: number } | { reason: string } {
  if (after.some((finding) => finding.file === target.rel && finding.line === undefined)) {
    return { reason: 'a finding left in the target has no line, so it cannot be told apart' };
  }
  const before = counts(baseline.map((finding) => comparableKey(finding, target, target.current)));
  const result = counts(after.map((finding) => comparableKey(finding, target, target.after)));
  for (const [key, count] of result) {
    if (count > (before.get(key) ?? 0)) return { reason: 'this edit adds a finding' };
  }
  const onTarget = (finding: ScriptFinding): boolean => finding.file === target.rel;
  const removed = baseline.filter(onTarget).length - after.filter(onTarget).length;
  return removed > 0 ? { removed } : { reason: 'this edit removes no finding from its target' };
}

function removedFindings(
  baseline: readonly ScriptFinding[],
  after: readonly ScriptFinding[],
  target: EditedTarget,
  violations: readonly RuleViolation[],
): RuleViolation[] {
  const left = counts(after.map((finding) => comparableKey(finding, target, target.after)));
  const removed = new Set<string>();
  for (const finding of baseline) {
    const key = comparableKey(finding, target, target.current);
    const remaining = left.get(key) ?? 0;
    if (remaining > 0) left.set(key, remaining - 1);
    else if (finding.file === target.rel) removed.add(exactKey(finding));
  }
  return violations.filter((violation) => removed.has(exactKey(violation)));
}

async function compareOnOverlay(
  input: EditResultInput,
  target: EditedTarget,
  scripts: readonly RerunScript[],
  changedFiles: readonly string[],
): Promise<EditResultVerdict> {
  const overlay = realpathSync(mkdtempSync(join(tmpdir(), 'paqad-edit-result-')));
  try {
    buildOverlay(input.projectRoot, target.rel, overlay);
    const overlayTarget = join(overlay, target.rel);
    writeFileSync(overlayTarget, target.current, { encoding: 'utf8', flag: 'wx' });
    const baseline = await scanOverlay(overlay, scripts, target.rel, changedFiles, input);
    if (baseline === null) return refuse('a rule script gave no answer');
    if (!matchesRealRun(baseline, scripts, target.rel, input.violations)) {
      return refuse('the comparison did not reproduce the findings of the real run');
    }
    rewriteNotThroughLink(overlayTarget, target.after);
    const after = await scanOverlay(overlay, scripts, target.rel, changedFiles, input);
    if (after === null) return refuse('a rule script gave no answer');
    const compared = compareResults(baseline, after, target);
    if ('reason' in compared) return refuse(compared.reason);
    return {
      allowed: true,
      target: target.rel,
      removed: removedFindings(baseline, after, target, input.violations),
      remaining: input.violations.length - compared.removed,
    };
  } finally {
    rmSync(overlay, { recursive: true, force: true });
  }
}

export async function judgeEditResult(input: EditResultInput): Promise<EditResultVerdict> {
  const rels = projectRelativeTargets(input.projectRoot, [...input.targets]);
  const rel = rels[0];
  if (input.targets.length !== 1 || rel === undefined) return NOT_A_CANDIDATE;
  if (sep !== '/' || rel.includes('\\')) return NOT_A_CANDIDATE;
  if (!input.violations.some((violation) => violation.file === rel)) return NOT_A_CANDIDATE;
  if (rel.startsWith(RULE_SOURCES_PREFIX)) return refuse('the target is a rule file');
  const read = readEditedTarget(input, rel);
  if ('reason' in read) return refuse(read.reason);
  const scripts = rerunScripts(input.projectRoot);
  if (scripts === null) return refuse('a rule script could not run');
  const evidence = await loadChangeEvidence(input.projectRoot);
  const changedFiles = Array.from(new Set([...evidence.files, rel]));
  return compareOnOverlay(input, read.target, scripts, changedFiles);
}
