import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import {
  assembleMap,
  collectRuleFiles,
  computeRuleFilesHash,
  scanAndEmbedIds,
  type RuleClassification,
} from '@/rule-scripts/analyzer.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { embedRuleIds, parseRuleFile } from '@/rule-scripts/rule-file.js';
import { isRuleId, parseRuleMarker, stripRuleMarker } from '@/rule-scripts/rule-id.js';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rule-scripts-'));
  roots.push(root);
  return root;
}

function writeRuleFile(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('rule-id markers', () => {
  it('round-trips marker parse / strip / embed', () => {
    const line = '- Keep changes deterministic. <!-- @rule RL-7f3a -->';
    expect(parseRuleMarker(line)).toBe('RL-7f3a');
    expect(stripRuleMarker(line).text).toBe('- Keep changes deterministic.');
    expect(isRuleId('RL-7f3a')).toBe(true);
    expect(isRuleId('XX-1')).toBe(false);
  });
});

describe('rule-file parsing', () => {
  it('finds bullets, skips fenced code blocks', () => {
    const content = [
      '## Rules',
      '',
      '- First rule.',
      '- Second rule.',
      '',
      '```',
      '- not a rule',
      '```',
    ].join('\n');
    const rules = parseRuleFile(content);
    expect(rules.map((r) => r.text)).toEqual(['First rule.', 'Second rule.']);
  });

  it('embeds ids idempotently', () => {
    const content = ['- Alpha rule.', '- Beta rule.'].join('\n');
    const taken = new Set<string>();
    const first = embedRuleIds('x.md', content, taken);
    expect(first.rules.every((r) => r.isNew)).toBe(true);
    expect(first.rules).toHaveLength(2);

    // Second pass over the already-marked content mints nothing and is a no-op.
    const second = embedRuleIds('x.md', first.content, new Set<string>());
    expect(second.content).toBe(first.content);
    expect(second.rules.every((r) => !r.isNew)).toBe(true);
  });

  it('mints distinct ids for identical text via collision extension', () => {
    const taken = new Set<string>();
    const out = embedRuleIds('x.md', ['- Same text.', '- Same text.'].join('\n'), taken);
    const ids = out.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('analyzer scan + assemble + apply', () => {
  it('embeds ids on disk, builds a map, and writes it atomically', () => {
    const root = createRoot();
    writeRuleFile(
      root,
      'docs/instructions/rules/coding/code-quality.md',
      '## Rules\n\n- No debugger.\n- Keep it deterministic.\n',
    );
    writeRuleFile(root, 'docs/instructions/rules/security/pentest.md', '- Validate all input.\n');

    const files = collectRuleFiles(root);
    expect(files).toContain('docs/instructions/rules/coding/code-quality.md');
    expect(files).toContain('docs/instructions/rules/security/pentest.md');

    const scan = scanAndEmbedIds(root);
    expect(scan.inventory).toHaveLength(3);
    expect(scan.changed_files).toHaveLength(2);
    expect(scan.rule_files_hash).toMatch(/^sha256-/);

    // Markers are now persisted in the source files.
    const onDisk = readFileSync(
      join(root, 'docs/instructions/rules/coding/code-quality.md'),
      'utf8',
    );
    expect(onDisk).toMatch(/<!-- @rule RL-[0-9a-f]+ -->/);

    // Re-scan is idempotent: no new ids, no file churn.
    const rescan = scanAndEmbedIds(root);
    expect(rescan.changed_files).toHaveLength(0);
    expect(rescan.inventory.map((i) => i.id)).toEqual(scan.inventory.map((i) => i.id));

    const classifications = new Map<string, RuleClassification>(
      scan.inventory.map((i) => [
        i.id,
        {
          id: i.id,
          verifiability: { kind: 'deterministic' as const },
          enforced_by: [],
        },
      ]),
    );
    const map = assembleMap(scan.inventory, classifications, scan.rule_files_hash, null);
    expect(map.rules).toHaveLength(3);
    expect(map.rules.every((r) => r.verifiability.kind === 'deterministic')).toBe(true);

    const result = applyRuleScriptMap({
      projectRoot: root,
      map,
      via: 'rule-analyzer',
      event: { action: 'analyze', rule_ids: map.rules.map((r) => r.id) },
    });
    expect(result.snapshot_path).toMatch(/\.history\//);

    const reloaded = loadRuleScriptMap(root);
    expect(reloaded?.rules).toHaveLength(3);
    expect(reloaded?.rule_files_hash).toBe(scan.rule_files_hash);
  });

  it('carries scripts forward for unchanged rules, drops them when text changes', () => {
    const root = createRoot();
    writeRuleFile(root, 'docs/instructions/rules/coding/q.md', '- Original rule.\n');
    const scan = scanAndEmbedIds(root);
    const id = scan.inventory[0].id;

    const prior = assembleMap(
      scan.inventory,
      new Map([[id, { id, verifiability: { kind: 'heuristic' }, enforced_by: [] }]]),
      scan.rule_files_hash,
      null,
    );
    prior.rules[0].scripts = [
      {
        path: '.paqad/scripts/rules/coding/q/001-x.mjs',
        kind: 'heuristic',
        runtime: 'node',
        scope: 'changed-files',
        last_validated_at: '2026-05-29T00:00:00Z',
        fixtures_passed: true,
      },
    ];

    // Unchanged text -> scripts carried over.
    const same = assembleMap(scan.inventory, new Map(), scan.rule_files_hash, prior);
    expect(same.rules[0].scripts).toHaveLength(1);

    // Edit the rule text -> hash differs -> scripts dropped.
    writeRuleFile(
      root,
      'docs/instructions/rules/coding/q.md',
      readFileSync(join(root, 'docs/instructions/rules/coding/q.md'), 'utf8').replace(
        'Original rule.',
        'Edited rule.',
      ),
    );
    const rescan = scanAndEmbedIds(root);
    expect(rescan.inventory[0].id).toBe(id); // id preserved across edit
    const edited = assembleMap(rescan.inventory, new Map(), rescan.rule_files_hash, prior);
    expect(edited.rules[0].scripts).toHaveLength(0);
  });
});

describe('computeRuleFilesHash', () => {
  it('changes when a rule file changes', () => {
    const root = createRoot();
    writeRuleFile(root, 'docs/instructions/rules/a.md', '- One.\n');
    const files = collectRuleFiles(root);
    const h1 = computeRuleFilesHash(root, files);
    writeRuleFile(root, 'docs/instructions/rules/a.md', '- One.\n- Two.\n');
    const h2 = computeRuleFilesHash(root, files);
    expect(h1).not.toBe(h2);
  });
});
