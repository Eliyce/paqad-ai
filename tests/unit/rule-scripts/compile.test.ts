import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileRuleScripts } from '@/rule-scripts/compile.js';
import { loadRuleScriptMap, ruleScriptMapPath } from '@/rule-scripts/map.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { existsSync } from 'node:fs';

// `compileRuleScripts` generates the rule-script map that arms the deterministic
// enforcement gate (issue #319). The engine was live but disarmed because nothing
// produced the map; this pins that the generator makes it exist, lists every rule,
// is idempotent, and carries prior script bindings.
describe('compileRuleScripts', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rules-compile-'));
    writeRule('coding/code-quality.md', '- Keep functions small.\n- Handle errors explicitly.\n');
    writeRule('security/pentest.md', '- Validate all input.\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRule(rel: string, body: string): void {
    const abs = join(root, 'docs/instructions/rules', rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }

  it('writes the map listing every rule (AC-1)', () => {
    const result = compileRuleScripts(root);

    expect(existsSync(ruleScriptMapPath(root))).toBe(true);
    expect(result.ruleCount).toBe(3);
    const map = loadRuleScriptMap(root);
    expect(map?.rules).toHaveLength(3);
    // Every rule got a stable id embedded into its source markdown.
    const codeQuality = readFileSync(
      join(root, 'docs/instructions/rules/coding/code-quality.md'),
      'utf8',
    );
    expect(codeQuality).toMatch(/@rule RL-[0-9a-f]{4}/);
  });

  it('is idempotent — a second compile over an unchanged tree is stable (AC-1)', () => {
    const first = compileRuleScripts(root);
    const firstMap = readFileSync(ruleScriptMapPath(root), 'utf8');

    const second = compileRuleScripts(root);
    // No new ids minted, no rule files rewritten the second time.
    expect(second.changedFiles).toHaveLength(0);
    expect(second.ruleCount).toBe(first.ruleCount);
    // Map content stable except its generated_at timestamp.
    const stripTs = (yaml: string) => yaml.replace(/generated_at:.*\n/, '');
    expect(stripTs(readFileSync(ruleScriptMapPath(root), 'utf8'))).toBe(stripTs(firstMap));
  });

  it('carries over a script bound to an unchanged rule (INV-1)', () => {
    compileRuleScripts(root);
    // Simulate the analyzer skill binding a script to the first rule.
    const map = loadRuleScriptMap(root)!;
    const target = map.rules[0]!;
    target.scripts = [
      {
        path: 'scripts/rules/demo.mjs',
        kind: 'deterministic',
        runtime: 'node',
        scope: 'changed-files',
        last_validated_at: '2026-01-01T00:00:00.000Z',
        fixtures_passed: true,
      },
    ];
    applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'test',
      event: { action: 'generate', rule_ids: [target.id] },
    });

    // Re-compiling must preserve that binding (text unchanged).
    const result = compileRuleScripts(root);
    expect(result.scriptedCount).toBe(1);
    const after = loadRuleScriptMap(root);
    expect(after?.rules.find((r) => r.id === target.id)?.scripts).toHaveLength(1);
  });
});
