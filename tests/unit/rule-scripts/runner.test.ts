import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { scanAndEmbedIds, assembleMap } from '@/rule-scripts/analyzer.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { readReport, ruleRunFindings, runRuleScripts } from '@/rule-scripts/runner.js';
import { readRuleRun } from '@/feature-evidence/bundle-ledgers.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-runner-'));
  roots.push(root);
  return root;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

const SCRIPT = `// @paqad-rule-script
// rule_id: __RID__
// source: docs/instructions/rules/coding/q.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const f of files) {
  const t = readFileSync(join(projectRoot, f), 'utf8');
  if (/\\bdebugger\\b/.test(t)) findings.push({ file: f, message: 'debugger', severity: 'blocker' });
}
process.stdout.write(JSON.stringify({ rule_id: '__RID__', kind: 'deterministic', findings }));
`;

function setup(
  targetBody: string,
  scope: 'changed-files' | 'whole-tree' = 'changed-files',
): { root: string; ruleId: string } {
  const root = createRoot();
  write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
  const scan = scanAndEmbedIds(root);
  const ruleId = scan.inventory[0].id;

  const scriptRel = '.paqad/scripts/rules/coding/q/001-no-debugger.mjs';
  write(join(root, scriptRel), SCRIPT.replaceAll('__RID__', ruleId));

  let map = assembleMap(
    scan.inventory,
    new Map([[ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }]]),
    scan.rule_files_hash,
    null,
  );
  map = upsertScriptEntry(map, ruleId, {
    path: scriptRel,
    kind: 'deterministic',
    runtime: 'node',
    scope,
    last_validated_at: '2026-05-29T00:00:00Z',
    fixtures_passed: true,
  });
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'generate', rule_ids: [ruleId] },
  });

  write(join(root, 'src/app.ts'), targetBody);
  return { root, ruleId };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('runRuleScripts', () => {
  it('blocks under strict when a deterministic script finds a violation', () => {
    const { root } = setup('function f() {\n  debugger;\n}\n');
    const report = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(report.counts.deterministic).toBe(1);
    expect(report.blocking).toBe(true);
    expect(readReport(root)?.blocking).toBe(true);
  });

  it('does not block under warn even with findings', () => {
    const { root } = setup('debugger;\n');
    const report = runRuleScripts({
      projectRoot: root,
      mode: 'warn',
      changedFiles: ['src/app.ts'],
    });
    expect(report.counts.deterministic).toBe(1);
    expect(report.blocking).toBe(false);
  });

  it('passes clean code with zero findings', () => {
    const { root } = setup('export const x = 1;\n');
    const report = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(report.counts.deterministic).toBe(0);
    expect(report.blocking).toBe(false);
  });

  it('re-uses the cached report when inputs are unchanged', () => {
    const { root } = setup('export const x = 1;\n');
    runRuleScripts({ projectRoot: root, mode: 'strict', changedFiles: ['src/app.ts'] });
    const second = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(second.from_cache).toBe(true);
  });

  it('returns an empty non-blocking report when no map exists', () => {
    const root = createRoot();
    const report = runRuleScripts({ projectRoot: root, mode: 'strict' });
    expect(report.results).toHaveLength(0);
    expect(report.blocking).toBe(false);
  });

  it('excludes git-ignored generated/vendored code from the whole-tree scan', () => {
    const { root } = setup('export const x = 1;\n', 'whole-tree');
    write(join(root, '.gitignore'), 'generated/\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    write(join(root, 'generated/out.js'), 'debugger;\n');

    const report = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(report.counts.deterministic).toBe(0);
    expect(report.blocking).toBe(false);
  });

  it('falls back to scanning when git cannot resolve ignores (not a repo)', () => {
    const { root } = setup('export const x = 1;\n', 'whole-tree');
    write(join(root, '.gitignore'), 'generated/\n');
    write(join(root, 'generated/out.js'), 'debugger;\n');

    const report = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(report.counts.deterministic).toBe(1);
    expect(report.blocking).toBe(true);
  });

  it('invalidates the cache for whole-tree scripts when an unrelated file changes (BUG-3)', () => {
    const { root } = setup('export const x = 1;\n', 'whole-tree');
    const first = runRuleScripts({ projectRoot: root, mode: 'warn', changedFiles: ['src/app.ts'] });
    expect(first.from_cache).toBeUndefined();

    write(join(root, 'src/other.ts'), 'debugger;\n');
    const second = runRuleScripts({
      projectRoot: root,
      mode: 'warn',
      changedFiles: ['src/app.ts'],
    });
    expect(second.from_cache).toBeUndefined();
    expect(second.counts.deterministic).toBe(1);
  });
});

describe('rule-run.jsonl rows', () => {
  const previousSession = process.env.SE_SESSION;
  afterEach(() => {
    if (previousSession === undefined) delete process.env.SE_SESSION;
    else process.env.SE_SESSION = previousSession;
  });

  it('records each finding by name, and a cache hit still records a row (AC-26, AC-28)', () => {
    const { root, ruleId } = setup('function f() {\n  debugger;\n}\n');
    process.env.SE_SESSION = 'ses_rr';
    const dir = openFeatureChange(root, 'ses_rr', {
      adapter: 'claude-code',
      title: 'Findings kept',
      issue: '639',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1',
    });
    const fresh = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    const cached = runRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(cached.from_cache).toBe(true);
    expect({ ...cached, from_cache: undefined }).toEqual({ ...fresh, from_cache: undefined });

    runRuleScripts({ projectRoot: root, mode: 'strict', changedFiles: ['src/app.ts'] });

    const rows = readRuleRun(root, dir) as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const finding = {
      rule_id: ruleId,
      file: 'src/app.ts',
      line: null,
      message: 'debugger',
      severity: 'blocker',
    };
    expect(rows[0]).toMatchObject({ kind: 'findings', blocking: true, findings: [finding] });
    expect(rows[0]).not.toHaveProperty('from_cache');
    expect(rows[1]).toMatchObject({
      kind: 'findings',
      blocking: true,
      counts: { deterministic: 1, heuristic: 0, skipped: 0 },
      findings: [finding],
      findings_overflow: 0,
      from_cache: true,
    });
  });

  it('takes findings only from scripts that ran, so the list matches the counts (AC-30)', () => {
    const findings = ruleRunFindings({
      generated_at: '2026-10-18T00:00:00.000Z',
      mode: 'warn',
      rule_files_hash: '',
      script_files_hash: '',
      target_files_hash: '',
      results: [
        {
          rule_id: 'a',
          script: 'a.mjs',
          kind: 'heuristic',
          findings: [{ file: 'x.ts', line: 3, message: 'm', severity: 'low' }],
        },
        { rule_id: 'b', script: 'b.mjs', kind: 'deterministic', findings: [], skipped: 'error' },
      ],
      counts: { deterministic: 0, heuristic: 1, skipped: 1 },
      blocking: false,
    });
    expect(findings).toEqual([
      { rule_id: 'a', file: 'x.ts', line: 3, message: 'm', severity: 'low' },
    ]);
  });

  it('gives no findings list for a cached report without results, never an empty one', () => {
    const partial = { counts: { deterministic: 2 }, blocking: false } as unknown as Parameters<
      typeof ruleRunFindings
    >[0];
    expect(ruleRunFindings(partial)).toBeUndefined();
  });
});
