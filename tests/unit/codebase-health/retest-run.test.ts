import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runHealthAudit, type HealthGatherer } from '@/codebase-health/run.js';
import { runHealthRetest } from '@/codebase-health/retest-run.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'hl-retest-'));
}

function indexWith(dead: boolean): CodeKnowledgeIndex {
  return {
    schema_version: 1,
    header: {
      generated_at: 'x',
      branch: null,
      head_commit: null,
      schema_version: 1,
      entry_point_globs: [],
    },
    symbols: [],
    files: dead ? [{ path: 'src/dead.ts', caller_count: 0, orphan: true, entry_point: false }] : [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  };
}

function gatherer(dead: boolean, over: Partial<HealthGatherer> = {}): HealthGatherer {
  return {
    availability: () => [],
    stack: async () => ({ primary: 'node', traits: [], toolchains: ['node'] }),
    loadIndex: () => indexWith(dead),
    vulnerabilities: async () => ({ records: [], blocked: [] }),
    secrets: async () => ({ matches: [] }),
    duplication: async () => ({ clusters: [], blocked: [] }),
    deprecations: async () => ({ records: [], blocked: [] }),
    staleDocs: async () => [],
    ...over,
  };
}

describe('runHealthRetest', () => {
  it('fails cleanly when there is no prior report', async () => {
    const result = await runHealthRetest({ projectRoot: repo() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no prior health report');
  });

  it('marks a finding fixed once the underlying problem is gone', async () => {
    const root = repo();
    // First run with the dead file present.
    const run = await runHealthAudit({
      projectRoot: root,
      gatherer: gatherer(true),
      now: () => new Date(2026, 0, 1, 0, 0, 0),
    });
    expect(run.finding_count).toBe(1);

    // Retest with the dead file gone → the finding is fixed.
    const result = await runHealthRetest({
      projectRoot: root,
      gatherer: gatherer(false),
      now: () => new Date(2026, 0, 2, 0, 0, 0),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fixed).toBe(1);
      expect(result.still_open).toBe(0);
      expect(result.exit_code).toBe(0);
      expect(existsSync(join(root, result.report_path))).toBe(true);
      expect(result.report_path).toContain('-retest-');
    }
  });

  it('keeps a finding still-open when it persists, and exits 1', async () => {
    const root = repo();
    await runHealthAudit({
      projectRoot: root,
      gatherer: gatherer(true),
      now: () => new Date(2026, 0, 1),
    });
    const result = await runHealthRetest({
      projectRoot: root,
      gatherer: gatherer(true),
      now: () => new Date(2026, 0, 2),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.still_open).toBe(1);
      expect(result.exit_code).toBe(1);
    }
  });

  it('reports an unreadable sidecar', async () => {
    const root = repo();
    const result = await runHealthRetest({
      projectRoot: root,
      sidecar: 'docs/health/missing.json',
    });
    expect(result.ok).toBe(false);
  });
});
