import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import YAML from 'yaml';

import { collectRuleCompliance } from '@/dashboard/collectors/rule-compliance.js';
import { appendRuleRun } from '@/feature-evidence/bundle-ledgers.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { RuleScriptDriftReport } from '@/rule-scripts/reconciler.js';
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

/**
 * Seed the live drift cache the dashboard now reads (issue #468 Phase B, D2). `counts`
 * accepts a partial and is filled with zeros so a test only names the codes it cares about.
 */
function writeDriftCache(
  root: string,
  blocked: boolean,
  counts: Record<string, number> = {},
): void {
  const report: RuleScriptDriftReport = {
    generated_at: '2026-08-12T00:00:00.000Z',
    findings: [],
    counts: {
      'RS-RULE-ADDED': 0,
      'RS-RULE-EDITED': 0,
      'RS-RULE-REMOVED': 0,
      'RS-SCRIPT-STALE': 0,
      'RS-FIXTURE-FAIL': 0,
      'RS-CONFLICT': 0,
      'RS-CACHE-INVALID': 0,
      ...counts,
    },
    blocked,
  };
  write(join(root, '.paqad/scripts/rules/.cache/drift.json'), JSON.stringify(report));
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
    // Issue #468 Phase B (D2) — the dashboard reads drift LIVE from the reconciler's
    // `.cache/drift.json`, since drift describes the project, not a change.
    writeDriftCache(root, true, { 'RS-RULE-EDITED': 1, 'RS-SCRIPT-STALE': 1 });
    const { section, attention } = collectRuleCompliance(root);
    expect(section.band).toBe('red');
    expect(attention.some((a) => a.message.includes('generate rule scripts'))).toBe(true);
  });

  it('is red on deterministic findings from the latest bundle rule-run row (#468 Phase B)', () => {
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
    // Findings now come from the per-feature bundle's rule-run.jsonl, latest by ts.
    openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 1 });
    appendRuleRun(root, 'ses_1', {
      kind: 'findings',
      counts: { deterministic: 0, heuristic: 0, skipped: 0 },
      blocking: false,
    });
    appendRuleRun(root, 'ses_1', {
      kind: 'findings',
      counts: { deterministic: 2, heuristic: 0, skipped: 0 },
      blocking: true,
    });
    const { section } = collectRuleCompliance(root);
    expect(section.band).toBe('red');
    expect(section.details?.deterministic_findings).toBe(2);
  });

  it('drift lives only in the cache, findings only in the bundle (#468 Phase B, D2)', () => {
    const root = createRoot();
    writeMap(root, baseMap([ruleEntry('RL-aaaa')]));
    // Drift blocked in the cache → red; no bundle findings row needed.
    writeDriftCache(root, true);
    const { section } = collectRuleCompliance(root);
    expect(section.band).toBe('red');
    expect(section.details?.drift_blocking).toBe(true);
  });
});
