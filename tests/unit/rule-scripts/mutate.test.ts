import { describe, expect, it } from 'vitest';

import {
  archiveRule,
  clearRuleScripts,
  setVerifiability,
  upsertScriptEntry,
} from '@/rule-scripts/mutate.js';
import {
  RULE_SCRIPT_MAP_SCHEMA_VERSION,
  type RuleScriptMap,
  type ScriptEntry,
} from '@/rule-scripts/types.js';

function baseMap(): RuleScriptMap {
  return {
    schema_version: RULE_SCRIPT_MAP_SCHEMA_VERSION,
    generated_at: '2026-05-29T00:00:00Z',
    rule_files_hash: 'sha256-x',
    rules: [
      {
        id: 'RL-aaaa',
        source: 'docs/instructions/rules/coding/q.md',
        text: 'No debugger.',
        text_hash: 'h1',
        verifiability: { kind: 'deterministic' },
        enforced_by: [],
        scripts: [],
      },
    ],
  };
}

const entry: ScriptEntry = {
  path: '.paqad/scripts/rules/coding/q/001-x.mjs',
  kind: 'deterministic',
  runtime: 'node',
  scope: 'changed-files',
  last_validated_at: '2026-05-29T00:00:00Z',
  fixtures_passed: true,
};

describe('rule-script map mutations', () => {
  it('upserts a script entry without mutating the input', () => {
    const map = baseMap();
    const next = upsertScriptEntry(map, 'RL-aaaa', entry);
    expect(next.rules[0].scripts).toHaveLength(1);
    expect(map.rules[0].scripts).toHaveLength(0); // input untouched

    // Re-upsert by same path replaces, not duplicates.
    const again = upsertScriptEntry(next, 'RL-aaaa', { ...entry, fixtures_passed: true });
    expect(again.rules[0].scripts).toHaveLength(1);
  });

  it('throws on an unknown rule id', () => {
    expect(() => upsertScriptEntry(baseMap(), 'RL-zzzz', entry)).toThrow(/not found/);
  });

  it('clears scripts', () => {
    const map = upsertScriptEntry(baseMap(), 'RL-aaaa', entry);
    expect(clearRuleScripts(map, 'RL-aaaa').rules[0].scripts).toHaveLength(0);
  });

  it('setting unverifiable drops scripts', () => {
    const map = upsertScriptEntry(baseMap(), 'RL-aaaa', entry);
    const next = setVerifiability(map, 'RL-aaaa', { kind: 'unverifiable', reason: 'fuzzy' });
    expect(next.rules[0].verifiability.kind).toBe('unverifiable');
    expect(next.rules[0].scripts).toHaveLength(0);
  });

  it('archives a rule into the archived section', () => {
    const next = archiveRule(baseMap(), 'RL-aaaa');
    expect(next.rules).toHaveLength(0);
    expect(next.archived).toHaveLength(1);
    expect(next.archived?.[0].id).toBe('RL-aaaa');
  });
});
