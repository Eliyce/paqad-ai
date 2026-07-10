import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanAndEmbedIds, assembleMap } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { enforceRuleScripts, formatEnforcementSummary } from '@/rule-scripts/enforce.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';

const roots: string[] = [];

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
  if (/\\bdebugger\\b/.test(t)) findings.push({ file: f, line: 1, message: 'debugger statement', severity: 'blocker' });
}
process.stdout.write(JSON.stringify({ rule_id: '__RID__', kind: 'deterministic', findings }));
`;

function setup(targetBody: string): { root: string; ruleId: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-enforce-'));
  roots.push(root);
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
    scope: 'changed-files',
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

describe('enforceRuleScripts', () => {
  it('blocks a scripted-rule violation under strict — even with the rule text not loaded', async () => {
    const { root, ruleId } = setup('function f() {\n  debugger;\n}\n');
    const result = await enforceRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(result.ran).toBe(true);
    expect(result.blocking).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      rule_id: ruleId,
      file: 'src/app.ts',
      message: 'debugger statement',
    });
    expect(result.summary).toContain('Needs your attention');
  });

  it('surfaces but does not block under warn', async () => {
    const { root } = setup('debugger;\n');
    const result = await enforceRuleScripts({
      projectRoot: root,
      mode: 'warn',
      changedFiles: ['src/app.ts'],
    });
    expect(result.ran).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.summary).toContain('Heads up');
  });

  it('passes clean code with no violations', async () => {
    const { root } = setup('export const x = 1;\n');
    const result = await enforceRuleScripts({
      projectRoot: root,
      mode: 'strict',
      changedFiles: ['src/app.ts'],
    });
    expect(result.ran).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.violations).toHaveLength(0);
    expect(result.summary).toContain('all clear');
  });

  it('fast-skips (ran=false) when the project has no rule-script map', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-enforce-nomap-'));
    roots.push(root);
    const result = await enforceRuleScripts({ projectRoot: root, mode: 'strict' });
    expect(result.ran).toBe(false);
    expect(result.blocking).toBe(false);
    expect(result.armed).toBe(0);
  });

  it('reports armed=0 and ran=false when the map catalogues rules but arms no scripts (#345 G4)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-enforce-unarmed-'));
    roots.push(root);
    write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
    const scan = scanAndEmbedIds(root);
    const ruleId = scan.inventory[0].id;
    // A map with the rule catalogued but scripts: [] — the state of a freshly compiled repo.
    const map = assembleMap(
      scan.inventory,
      new Map([
        [ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }],
      ]),
      scan.rule_files_hash,
      null,
    );
    applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'test',
      event: { action: 'generate', rule_ids: [ruleId] },
    });
    const result = await enforceRuleScripts({ projectRoot: root, mode: 'strict' });
    expect(result.ran).toBe(false);
    expect(result.armed).toBe(0);
  });

  it('fast-skips when mode is off, regardless of scripts', async () => {
    const { root } = setup('debugger;\n');
    const result = await enforceRuleScripts({ projectRoot: root, mode: 'off' });
    expect(result.ran).toBe(false);
    expect(result.blocking).toBe(false);
  });
});

describe('formatEnforcementSummary', () => {
  it('reads as a clean verdict with no violations', () => {
    expect(formatEnforcementSummary({ mode: 'strict', blocking: false, violations: [] })).toContain(
      '🟢 all clear',
    );
  });

  it('caps the listed violations and notes the overflow', () => {
    const violations = Array.from({ length: 25 }, (_, i) => ({
      rule_id: `R-${i}`,
      script: 's.mjs',
      file: `f${i}.ts`,
      message: 'bad',
      severity: 'blocker' as const,
    }));
    const summary = formatEnforcementSummary({ mode: 'strict', blocking: true, violations });
    expect(summary).toContain('and 5 more');
  });
});
