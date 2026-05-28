import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectModuleMapDrift } from '@/dashboard/collectors/module-map-drift';

function writeDrift(root: string, body: unknown): void {
  mkdirSync(join(root, '.paqad/module-map'), { recursive: true });
  writeFileSync(join(root, '.paqad/module-map/drift.json'), JSON.stringify(body));
}

describe('collectModuleMapDrift', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mmd-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown band when drift.json is absent', () => {
    const result = collectModuleMapDrift(root);
    expect(result.section.band).toBe('unknown');
    expect(result.section.score).toBeNull();
    expect(result.attention).toEqual([]);
  });

  it('surfaces a blocked report as unknown band with a warn attention item', () => {
    writeDrift(root, {
      generated_at: '2026-05-28T00:00:00Z',
      source_roots: [],
      findings: [],
      blocked: 'source_roots_unknown',
      counts: { 'MM-ADD': 0, 'MM-FEAT-ADD': 0, 'MM-REMOVE': 0, 'MM-RENAME': 0, 'MM-FEAT-STALE': 0, 'MM-DOC-ORPHAN': 0, 'MM-DOC-MISSING': 0, 'MM-MISMATCH': 0 },
    });
    const result = collectModuleMapDrift(root);
    expect(result.section.band).toBe('unknown');
    expect(result.attention).toHaveLength(1);
    expect(result.attention[0]?.severity).toBe('warn');
  });

  it('scores 100 on a clean reconcile and emits no attention', () => {
    writeDrift(root, {
      generated_at: '2026-05-28T00:00:00Z',
      source_roots: ['src'],
      findings: [],
      blocked: null,
      counts: { 'MM-ADD': 0, 'MM-FEAT-ADD': 0, 'MM-REMOVE': 0, 'MM-RENAME': 0, 'MM-FEAT-STALE': 0, 'MM-DOC-ORPHAN': 0, 'MM-DOC-MISSING': 0, 'MM-MISMATCH': 0 },
    });
    const result = collectModuleMapDrift(root);
    expect(result.section.score).toBe(100);
    expect(result.attention).toEqual([]);
  });

  it('escalates undeclared paths to a critical attention when 3+ findings', () => {
    writeDrift(root, {
      generated_at: '2026-05-28T00:00:00Z',
      source_roots: ['src'],
      findings: [
        { code: 'MM-ADD', module_slug: null, feature_slug: null, paths: ['src/a/x.ts'], detail: 'a' },
        { code: 'MM-ADD', module_slug: null, feature_slug: null, paths: ['src/b/x.ts'], detail: 'b' },
        { code: 'MM-ADD', module_slug: null, feature_slug: null, paths: ['src/c/x.ts'], detail: 'c' },
        { code: 'MM-DOC-MISSING', module_slug: 'foo', feature_slug: null, paths: ['docs/modules/foo/'], detail: 'missing' },
      ],
      blocked: null,
      counts: { 'MM-ADD': 3, 'MM-FEAT-ADD': 0, 'MM-REMOVE': 0, 'MM-RENAME': 0, 'MM-FEAT-STALE': 0, 'MM-DOC-ORPHAN': 0, 'MM-DOC-MISSING': 1, 'MM-MISMATCH': 0 },
    });
    const result = collectModuleMapDrift(root);
    expect(result.section.score).toBe(68); // 100 - 4*8
    const criticals = result.attention.filter((a) => a.severity === 'critical');
    expect(criticals).toHaveLength(1);
    expect(criticals[0]?.message).toContain('undeclared');
  });
});
