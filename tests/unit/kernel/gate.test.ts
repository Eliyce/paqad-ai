import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCapabilityGate } from '@/kernel/gate.js';
import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';

const MAP_REL = 'docs/instructions/rules/rule-script-map.yml';
const SCRIPT_REL = '.paqad/scripts/rules/coding/q/001-no-debugger.mjs';
const LOCK_REL = '.paqad/capability-lock.json';

// Buildout F3 — the capability-kernel executor. These tests drive a REAL
// rule-script map through runCapabilityGate (the rule-scripts capability is the
// first contract folded into the seam), proving the gate wires the leaf logic and
// aggregates the block/allow decision — not a mocked stand-in.

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

/** Build a project with one deterministic rule-script and a `rule_compliance`
 *  team config, plus a target file to scan. */
function setup(mode: 'off' | 'warn' | 'strict', targetBody: string): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-kernel-gate-'));
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
  // The team-tracked floor sets the mode (the C2 clamp); no local override raises it.
  write(join(root, '.paqad/configs/.config.policy'), `rule_compliance=${mode}\n`);
  write(join(root, 'src/app.ts'), targetBody);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('runCapabilityGate', () => {
  it('blocks a scripted-rule violation under strict at the pre-mutation seam', async () => {
    const root = setup('strict', 'function f() {\n  debugger;\n}\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('Needs your attention');
  });

  it('also evaluates the rule-scripts capability at the completion seam', async () => {
    const root = setup('strict', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'completion' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('Needs your attention');
  });

  it('surfaces a warn finding without blocking', async () => {
    const root = setup('warn', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('Heads up');
  });

  it('is a clean no-op when a strict scan finds no violation (map present, ran but empty)', async () => {
    const root = setup('strict', 'export const x = 1;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('clamps a local rule_compliance=off below the strict team floor (cannot weaken)', async () => {
    const root = setup('strict', 'debugger;\n');
    // A dev-local attempt to disable enforcement must be ignored — team floor wins.
    write(join(root, '.paqad/.config'), 'rule_compliance=off\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
  });

  it('does not block when the team floors rule_compliance to off', async () => {
    const root = setup('off', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  it('is a clean no-op when the project has no rule-script map', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-kernel-gate-nomap-'));
    roots.push(root);
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toBe('');
  });

  // Buildout F5 (decision D1, audit) — the integrity lock catches a binding
  // edited outside the engine, so a weakening can't pass silently.

  it('writes the capability lock when the engine applies the map', () => {
    const root = setup('strict', 'export const x = 1;\n');
    const lock = JSON.parse(readFileSync(join(root, LOCK_REL), 'utf8')) as {
      capabilities: Record<string, { digest: string }>;
    };
    expect(typeof lock.capabilities['rule-scripts'].digest).toBe('string');
    expect(lock.capabilities['rule-scripts'].digest.length).toBeGreaterThan(0);
  });

  it('blocks under strict when a script is hand-edited outside the engine (tamper)', async () => {
    const root = setup('strict', 'export const x = 1.0;\n'); // clean: a neutered script would pass
    // Hand-edit the script WITHOUT going through the engine → lock goes stale.
    appendFileSync(join(root, SCRIPT_REL), '\n// hand-edit that the engine never blessed\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    expect(result.summary).toContain('changed outside the engine');
  });

  it('surfaces tamper without blocking under warn (map hand-edited)', async () => {
    const root = setup('warn', 'export const x = 1;\n');
    // A semantic map edit that bypasses the single-writer (engine) path.
    const mapPath = join(root, MAP_REL);
    writeFileSync(
      mapPath,
      readFileSync(mapPath, 'utf8').replace('fixtures_passed: true', 'fixtures_passed: false'),
    );
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('changed outside the engine');
    expect(result.summary).toContain('warn mode');
  });

  it('surfaces an advisory (never blocks) when the bindings have no lock yet', async () => {
    const root = setup('strict', 'export const x = 1;\n'); // clean code → no real violation
    rmSync(join(root, LOCK_REL), { force: true }); // simulate a pre-F5 map (no lock)
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(false);
    expect(result.summary).toContain('not yet attested');
  });

  it('a real violation still blocks when the lock is intact (no false tamper)', async () => {
    const root = setup('strict', 'debugger;\n');
    const result = await runCapabilityGate({ projectRoot: root, seam: 'pre-mutation' });
    expect(result.block).toBe(true);
    // The real violation verdict, not the tamper one.
    expect(result.summary).toContain('Needs your attention');
    expect(result.summary).not.toContain('changed outside the engine');
  });
});
