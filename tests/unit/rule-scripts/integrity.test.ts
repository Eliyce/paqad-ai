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

import { assembleMap, scanAndEmbedIds } from '@/rule-scripts/analyzer.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { computeRuleScriptsDigest } from '@/rule-scripts/integrity.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';

// Buildout F5 — the integrity digest is hash-only (no script execution) and
// changes when either the map or a referenced script changes.

const roots: string[] = [];
const SCRIPT_REL = '.paqad/scripts/rules/coding/q/001-no-debugger.mjs';
const MAP_REL = 'docs/instructions/rules/rule-script-map.yml';

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
process.stdout.write(JSON.stringify({ rule_id: '__RID__', kind: 'deterministic', findings: [] }));
`;

function setup(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-integrity-'));
  roots.push(root);
  write(join(root, 'docs/instructions/rules/coding/q.md'), '- No debugger statements.\n');
  const scan = scanAndEmbedIds(root);
  const ruleId = scan.inventory[0].id;
  write(join(root, SCRIPT_REL), SCRIPT.replaceAll('__RID__', ruleId));
  let map = assembleMap(
    scan.inventory,
    new Map([[ruleId, { id: ruleId, verifiability: { kind: 'deterministic' }, enforced_by: [] }]]),
    scan.rule_files_hash,
    null,
  );
  map = upsertScriptEntry(map, ruleId, {
    path: SCRIPT_REL,
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
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('computeRuleScriptsDigest', () => {
  it('is null when there is no rule-script map', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-integrity-nomap-'));
    roots.push(root);
    expect(computeRuleScriptsDigest(root)).toBeNull();
  });

  it('is stable across repeated calls for an unchanged project', () => {
    const root = setup();
    expect(computeRuleScriptsDigest(root)).toBe(computeRuleScriptsDigest(root));
  });

  it('changes when a referenced script is edited', () => {
    const root = setup();
    const before = computeRuleScriptsDigest(root);
    appendFileSync(join(root, SCRIPT_REL), '\n// edited\n');
    expect(computeRuleScriptsDigest(root)).not.toBe(before);
  });

  it('changes when the map is edited', () => {
    const root = setup();
    const before = computeRuleScriptsDigest(root);
    const mapPath = join(root, MAP_REL);
    writeFileSync(
      mapPath,
      readFileSync(mapPath, 'utf8').replace('fixtures_passed: true', 'fixtures_passed: false'),
    );
    expect(computeRuleScriptsDigest(root)).not.toBe(before);
  });
});
