import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { assembleMap, scanAndEmbedIds, type RuleClassification } from '@/rule-scripts/analyzer.js';
import { addRule, editRuleText, removeRuleBullet } from '@/rule-scripts/editor.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { reconcileRuleScripts } from '@/rule-scripts/reconciler.js';
import { parseRuleMarker } from '@/rule-scripts/rule-id.js';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-recon-'));
  roots.push(root);
  return root;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

// Build a project whose map is in sync with the rule files.
function syncedProject(): { root: string; ids: string[]; file: string } {
  const root = createRoot();
  const file = 'docs/instructions/rules/coding/q.md';
  write(join(root, file), '- No debugger.\n- Keep it deterministic.\n');
  const scan = scanAndEmbedIds(root);
  const classifications = new Map<string, RuleClassification>(
    scan.inventory.map((i) => [
      i.id,
      { id: i.id, verifiability: { kind: 'deterministic' as const }, enforced_by: [] },
    ]),
  );
  const map = assembleMap(scan.inventory, classifications, scan.rule_files_hash, null);
  applyRuleScriptMap({
    projectRoot: root,
    map,
    via: 'test',
    event: { action: 'analyze', rule_ids: scan.inventory.map((i) => i.id) },
  });
  return { root, ids: scan.inventory.map((i) => i.id), file };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('reconciler', () => {
  it('reports a clean tree when the map is in sync', () => {
    const { root } = syncedProject();
    const report = reconcileRuleScripts(root);
    expect(report.findings).toHaveLength(0);
    expect(report.blocked).toBe(false);
  });

  it('detects an unmarked bullet as RS-RULE-ADDED', () => {
    const { root, file } = syncedProject();
    const current = readFileSync(join(root, file), 'utf8');
    writeFileSync(join(root, file), `${current}- A brand new rule.\n`, 'utf8');
    const report = reconcileRuleScripts(root);
    expect(report.counts['RS-RULE-ADDED']).toBe(1);
    expect(report.blocked).toBe(true);
  });

  it('detects an edited rule as RS-RULE-EDITED', () => {
    const { root, file } = syncedProject();
    const edited = readFileSync(join(root, file), 'utf8').replace(
      'No debugger.',
      'No debugger ever.',
    );
    writeFileSync(join(root, file), edited, 'utf8');
    const report = reconcileRuleScripts(root);
    expect(report.counts['RS-RULE-EDITED']).toBe(1);
  });

  it('detects a removed marker as RS-RULE-REMOVED', () => {
    const { root, file } = syncedProject();
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    // Drop the first marked rule line entirely.
    const remaining = lines.filter((l) => !l.includes('No debugger.'));
    writeFileSync(join(root, file), remaining.join('\n'), 'utf8');
    const report = reconcileRuleScripts(root);
    expect(report.counts['RS-RULE-REMOVED']).toBe(1);
  });
});

describe('editor', () => {
  it('adds a rule with a fresh unique marker', () => {
    const { root, ids, file } = syncedProject();
    const { id } = addRule(root, file, 'A freshly added rule.');
    expect(ids).not.toContain(id);
    const content = readFileSync(join(root, file), 'utf8');
    expect(content).toContain(`<!-- @rule ${id} -->`);
  });

  it('edits a rule preserving its id', () => {
    const { root, ids, file } = syncedProject();
    const target = ids[0];
    const located = editRuleText(root, target, 'Completely rewritten rule.');
    expect(located?.source).toBe(file);
    const content = readFileSync(join(root, file), 'utf8');
    expect(content).toContain('Completely rewritten rule.');
    // The id marker is preserved on the rewritten line.
    const line = content.split('\n').find((l) => l.includes('Completely rewritten rule.'));
    expect(parseRuleMarker(line ?? '')).toBe(target);
  });

  it('removes a rule bullet by id', () => {
    const { root, ids, file } = syncedProject();
    const removed = removeRuleBullet(root, ids[0]);
    expect(removed?.source).toBe(file);
    const content = readFileSync(join(root, file), 'utf8');
    expect(content).not.toContain(`<!-- @rule ${ids[0]} -->`);
  });

  it('returns null when editing an unknown id', () => {
    const { root } = syncedProject();
    expect(editRuleText(root, 'RL-ffff', 'x')).toBeNull();
    expect(removeRuleBullet(root, 'RL-ffff')).toBeNull();
  });

  it('reconciler flags a removed rule that is still in the map', () => {
    const { root, ids } = syncedProject();
    removeRuleBullet(root, ids[0]);
    const report = reconcileRuleScripts(root);
    expect(report.counts['RS-RULE-REMOVED']).toBe(1);
    // The map still has both rules until rule-editor archives the entry.
    expect(loadRuleScriptMap(root)?.rules).toHaveLength(2);
  });
});
