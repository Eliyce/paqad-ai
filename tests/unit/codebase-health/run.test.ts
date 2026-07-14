import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { runHealthAudit, type HealthGatherer } from '@/codebase-health/run.js';
import { readBaseline } from '@/codebase-health/baseline.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'hl-run-'));
}

function index(): CodeKnowledgeIndex {
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
    files: [{ path: 'src/dead.ts', caller_count: 0, orphan: true, entry_point: false }],
    import_edges: [],
    reference_edges: [],
    dependencies: [{ name: 'unused', ecosystem: 'node', imported: false }],
  };
}

function fakeGatherer(over: Partial<HealthGatherer> = {}): HealthGatherer {
  return {
    availability: () => [
      { tool: 'osv-scanner', available: false, used_for: ['vulnerable-dependency'] },
    ],
    stack: async () => ({ primary: 'node', traits: [], toolchains: ['node'] }),
    loadIndex: () => index(),
    vulnerabilities: async () => ({
      records: [],
      blocked: [
        { check: 'vulnerable-dependency', reason: 'no osv-scanner', install_hint: 'install' },
      ],
    }),
    secrets: async () => ({ matches: [] }),
    duplication: async () => ({ clusters: [], blocked: [] }),
    deprecations: async () => ({ records: [], blocked: [] }),
    staleDocs: async () => [],
    ...over,
  };
}

describe('runHealthAudit', () => {
  it('dual-writes the report, records a baseline on the first run, and reports findings', async () => {
    const root = repo();
    const now = () => new Date(2026, 6, 14, 9, 0, 0);
    const result = await runHealthAudit({
      projectRoot: root,
      offline: true,
      gatherer: fakeGatherer(),
      now,
    });

    expect(result.finding_count).toBeGreaterThan(0);
    expect(result.exit_code).toBe(1);
    expect(result.baseline_created).toBe(true);
    expect(existsSync(join(root, result.report_path))).toBe(true);
    expect(existsSync(join(root, result.sidecar_path))).toBe(true);
    expect(
      existsSync(join(root, PATHS.HEALTH_RUNS_DIR, result.report_id, 'finding-index.json')),
    ).toBe(true);
    expect(readBaseline(root)).not.toBeNull();
    // The gatherer's blocked check flows into the report.
    expect(result.blocked_checks.some((b) => b.check === 'vulnerable-dependency')).toBe(true);
  });

  it('adds an index-not-built blocked check and exits 0 clean when there are no findings', async () => {
    const root = repo();
    const result = await runHealthAudit({
      projectRoot: root,
      gatherer: fakeGatherer({ loadIndex: () => null }),
      now: () => new Date(2026, 0, 1),
    });
    expect(result.exit_code).toBe(0);
    expect(result.finding_count).toBe(0);
    expect(result.blocked_checks.some((b) => b.check.includes('unused-dependency'))).toBe(true);
  });

  it('does not recreate the baseline on a second run', async () => {
    const root = repo();
    const gatherer = fakeGatherer();
    await runHealthAudit({ projectRoot: root, gatherer, now: () => new Date(2026, 0, 1, 0, 0, 0) });
    const second = await runHealthAudit({
      projectRoot: root,
      gatherer,
      now: () => new Date(2026, 0, 2, 0, 0, 0),
    });
    expect(second.baseline_created).toBe(false);
  });

  it('writes valid JSON into the sidecar', async () => {
    const root = repo();
    const result = await runHealthAudit({
      projectRoot: root,
      gatherer: fakeGatherer(),
      now: () => new Date(2026, 0, 1),
    });
    const parsed = JSON.parse(readFileSync(join(root, result.sidecar_path), 'utf8'));
    expect(parsed.generated_by).toBe('paqad-ai');
  });
});
