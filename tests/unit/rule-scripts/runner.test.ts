import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { scanAndEmbedIds, assembleMap } from '@/rule-scripts/analyzer.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import { readReport, runRuleScripts } from '@/rule-scripts/runner.js';

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

// Build a project with one rule, one registered script, and a target file.
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
    // A whole-tree script must not read files the team gitignores (build output,
    // vendored deps, generated code) — otherwise deterministic findings in code
    // the developer cannot hand-fix block the strict gate. Regression for the
    // v1.41.0 scanner reading gitignored build/vendor code.
    const { root } = setup('export const x = 1;\n', 'whole-tree');
    write(join(root, '.gitignore'), 'generated/\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    // The only violation lives in gitignored generated output.
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
    // Same layout, but no `git init` — `git check-ignore` cannot run, so the
    // scanner keeps its best-effort static-ignore behaviour and still reads the
    // file. Proves the git filter is what excludes it above, not the glob list.
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
    // A whole-tree-scoped script scans the whole tree even on a changed-files
    // run, so an unrelated mutation must bust the cache.
    const { root } = setup('export const x = 1;\n', 'whole-tree');
    const first = runRuleScripts({ projectRoot: root, mode: 'warn', changedFiles: ['src/app.ts'] });
    expect(first.from_cache).toBeUndefined();

    // Mutate a file NOT in changedFiles.
    write(join(root, 'src/other.ts'), 'debugger;\n');
    const second = runRuleScripts({
      projectRoot: root,
      mode: 'warn',
      changedFiles: ['src/app.ts'],
    });
    expect(second.from_cache).toBeUndefined();
    // The whole-tree script now sees the new violation.
    expect(second.counts.deterministic).toBe(1);
  });
});
