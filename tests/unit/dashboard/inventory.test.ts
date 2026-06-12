import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { buildInventory, type InventoryItem } from '@/dashboard/inventory.js';

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function byKey(items: InventoryItem[], key: string): InventoryItem {
  const item = items.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`missing inventory item: ${key}`);
  return item;
}

describe('buildInventory', () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-inventory-'));
    home = mkdtempSync(join(tmpdir(), 'paqad-inventory-home-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('classifies every functionality exactly once with the spec classes', () => {
    const report = buildInventory(root, { paqadHome: home });

    expect(report.schemaVersion).toBe(1);
    const keys = report.items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);

    const byClass = (cls: string) => report.items.filter((item) => item.class === cls);
    expect(byClass('web').length).toBe(13);
    expect(byClass('prompt').length).toBe(5);
    expect(byClass('evidence').length).toBe(12);
    expect(byClass('operation').length).toBe(1);

    for (const item of report.items) {
      expect(item.route.startsWith('#/'), `${item.key} route`).toBe(true);
      expect(item.why.length, `${item.key} why`).toBeGreaterThan(0);
      expect(item.why.includes('—'), `${item.key} why must not contain em dashes`).toBe(false);
      expect(item.why.includes('!'), `${item.key} why must not contain exclamation marks`).toBe(
        false,
      );
      expect(['you', 'paqad', 'shared']).toContain(item.managedBy);
    }
  });

  it('evidence items are never owned by the human and never editable', () => {
    const report = buildInventory(root, { paqadHome: home });
    for (const item of report.items.filter((candidate) => candidate.class === 'evidence')) {
      expect(item.managedBy, item.key).toBe('paqad');
    }
  });

  it('reports empty states on a bare project', () => {
    const { items } = buildInventory(root, { paqadHome: home });

    expect(byKey(items, 'instructions').state).toMatchObject({ exists: false, count: 0 });
    expect(byKey(items, 'profile').state.exists).toBe(false);
    expect(byKey(items, 'delivery-policy').state.detail).toBe('Using framework defaults');
    expect(byKey(items, 'rag').state.detail).toBe('Disabled');
    expect(byKey(items, 'approvals').state.detail).toBe('Nothing needs you');
    expect(byKey(items, 'module-map-drift').state.detail).toBe('No reconcile run yet');
    expect(byKey(items, 'operations').state.count).toBe(10);
  });

  it('counts live state on a populated project', () => {
    write(root, 'docs/instructions/rules/a.md', '# a');
    write(root, 'docs/instructions/stack/b.yml', 'x: 1');
    write(root, 'docs/instructions/workflows/development.yaml', 'name: development');
    write(root, 'docs/instructions/workflows/delivery-policy.yaml', 'enabled: true');
    write(
      root,
      'docs/instructions/rules/module-map.yml',
      'modules:\n  - slug: one\n  - slug: two\n',
    );
    write(
      root,
      '.paqad/project-profile.yaml',
      'project: { name: Demo }\nactive_capabilities: [content, coding]\nintelligence:\n  rag_enabled: true\n',
    );
    write(root, '.paqad/vectors/index.json', '{}');
    write(root, '.paqad/decisions/pending/D-1.json', '{}');
    write(root, '.paqad/decisions/module-decisions/MD-0001.json', '{}');
    write(root, '.paqad/ledger/evidence.jsonl', '{"a":1}\n{"a":2}\n');
    write(root, '.paqad/ledger/receipts.jsonl', '{"r":1}\n');
    write(root, '.paqad/audit.log', 'line one\nline two\nline three\n');
    write(root, '.paqad/module-map/drift.json', '{"findings":[{"code":"MM-ADD"}]}');
    write(root, 'CLAUDE.md', '# entry');
    write(root, 'AGENTS.md', '# entry');
    write(home, 'packs/laravel/pack.yaml', 'name: laravel');
    write(home, 'patterns/p1.json', '{}');

    const { items } = buildInventory(root, { paqadHome: home });

    // a.md + b.yml + module-map.yml + the two workflow yaml files
    expect(byKey(items, 'instructions').state.count).toBe(5);
    expect(byKey(items, 'workflows').state.count).toBe(2);
    expect(byKey(items, 'delivery-policy').state.detail).toBe('Policy file present');
    expect(byKey(items, 'module-map').state).toMatchObject({ exists: true, count: 2 });
    expect(byKey(items, 'profile').state.exists).toBe(true);
    expect(byKey(items, 'capabilities').state.count).toBe(2);
    expect(byKey(items, 'packs').state.count).toBe(1);
    expect(byKey(items, 'patterns').state.count).toBe(1);
    expect(byKey(items, 'providers').state.count).toBe(2);
    expect(byKey(items, 'rag').state.detail).toBe('Enabled with an index');
    expect(byKey(items, 'approvals').state).toMatchObject({ exists: true, count: 2 });
    expect(byKey(items, 'module-proposals').state.count).toBe(1);
    expect(byKey(items, 'evidence-ledger').state.count).toBe(2);
    expect(byKey(items, 'receipts').state.count).toBe(1);
    expect(byKey(items, 'audit-log').state.count).toBe(3);
    expect(byKey(items, 'module-map-drift').state).toMatchObject({ exists: true, count: 1 });
  });

  it('reports rag enabled without an index distinctly', () => {
    write(root, '.paqad/project-profile.yaml', 'intelligence:\n  rag_enabled: true\n');
    const { items } = buildInventory(root, { paqadHome: home });
    expect(byKey(items, 'rag').state.detail).toBe('Enabled, index not built');
  });

  it('tolerates malformed YAML and JSON sources', () => {
    write(root, '.paqad/project-profile.yaml', '[unbalanced');
    write(root, 'docs/instructions/rules/module-map.yml', '[unbalanced');
    write(root, '.paqad/module-map/drift.json', 'not json');

    const { items } = buildInventory(root, { paqadHome: home });
    expect(byKey(items, 'profile').state.exists).toBe(false);
    expect(byKey(items, 'module-map').state.count).toBe(0);
    expect(byKey(items, 'module-map-drift').state.detail).toBe('No reconcile run yet');
  });

  it('ignores dotfiles when counting instruction files', () => {
    write(root, 'docs/instructions/.hidden/skip.md', 'x');
    write(root, 'docs/instructions/rules/real.md', 'x');
    const { items } = buildInventory(root, { paqadHome: home });
    expect(byKey(items, 'instructions').state.count).toBe(1);
  });

  it('stamps generatedAt from the provided clock', () => {
    const report = buildInventory(root, { paqadHome: home, now: 1750000000000 });
    expect(report.generatedAt).toBe(new Date(1750000000000).toISOString());
  });
});
