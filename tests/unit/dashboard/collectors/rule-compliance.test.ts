import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import YAML from 'yaml';

import { collectRuleCompliance } from '@/dashboard/collectors/rule-compliance.js';
import { RULE_SCRIPT_MAP_SCHEMA_VERSION, type RuleScriptMap } from '@/rule-scripts/types.js';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rc-collector-'));
  roots.push(root);
  return root;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function writeMap(root: string, map: RuleScriptMap): void {
  write(join(root, 'docs/instructions/rules/rule-script-map.yml'), YAML.stringify(map));
}

function ruleEntry(id: string, overrides: Partial<RuleScriptMap['rules'][number]> = {}) {
  return {
    id,
    source: 'docs/instructions/rules/coding/q.md',
    text: 't',
    text_hash: 'h',
    verifiability: { kind: 'deterministic' as const },
    enforced_by: [] as string[],
    scripts: [] as RuleScriptMap['rules'][number]['scripts'],
    ...overrides,
  };
}

function baseMap(rules: RuleScriptMap['rules']): RuleScriptMap {
  return {
    schema_version: RULE_SCRIPT_MAP_SCHEMA_VERSION,
    generated_at: '2026-05-29T00:00:00Z',
    rule_files_hash: 'sha256-x',
    rules,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('collectRuleCompliance', () => {
  it('is unknown and plants the analyze prompt when no map exists', () => {
    const root = createRoot();
    const { section, attention } = collectRuleCompliance(root);
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(attention[0].message).toContain('analyze rules');
  });

  it('is amber with a generate prompt when verifiable rules lack scripts', () => {
    const root = createRoot();
    writeMap(root, baseMap([ruleEntry('RL-aaaa'), ruleEntry('RL-bbbb')]));
    const { section, attention } = collectRuleCompliance(root);
    expect(section.band).toBe('amber');
    expect(attention.some((a) => a.message.includes('generate rule scripts'))).toBe(true);
  });

  it('is green when every verifiable rule is covered', () => {
    const root = createRoot();
    writeMap(
      root,
      baseMap([
        ruleEntry('RL-aaaa', {
          scripts: [
            {
              path: '.paqad/scripts/rules/coding/q/001-x.mjs',
              kind: 'deterministic',
              runtime: 'node',
              scope: 'changed-files',
              last_validated_at: '2026-05-29T00:00:00Z',
              fixtures_passed: true,
            },
          ],
        }),
        ruleEntry('RL-bbbb', { verifiability: { kind: 'unverifiable', reason: 'fuzzy' } }),
        ruleEntry('RL-cccc', { enforced_by: ['eslint:no-debugger'] }),
      ]),
    );
    const { section } = collectRuleCompliance(root);
    expect(section.band).toBe('green');
    expect(section.score).toBe(100);
  });

  it('is red when the drift report is blocking', () => {
    const root = createRoot();
    writeMap(
      root,
      baseMap([
        ruleEntry('RL-aaaa', {
          scripts: [
            {
              path: '.paqad/scripts/rules/coding/q/001-x.mjs',
              kind: 'deterministic',
              runtime: 'node',
              scope: 'changed-files',
              last_validated_at: '2026-05-29T00:00:00Z',
              fixtures_passed: true,
            },
          ],
        }),
      ]),
    );
    write(
      join(root, '.paqad/scripts/rules/.cache/drift.json'),
      JSON.stringify({
        generated_at: '2026-05-29T00:00:00Z',
        findings: [],
        counts: {
          'RS-RULE-ADDED': 0,
          'RS-RULE-EDITED': 1,
          'RS-RULE-REMOVED': 0,
          'RS-SCRIPT-STALE': 1,
          'RS-FIXTURE-FAIL': 0,
          'RS-CACHE-INVALID': 0,
        },
        blocked: true,
      }),
    );
    const { section, attention } = collectRuleCompliance(root);
    expect(section.band).toBe('red');
    expect(attention.some((a) => a.message.includes('generate rule scripts'))).toBe(true);
  });
});
