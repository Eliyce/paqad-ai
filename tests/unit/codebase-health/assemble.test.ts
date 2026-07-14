import { describe, expect, it } from 'vitest';

import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import type { HealthAssemblyInput } from '@/codebase-health/assemble.js';
import { assembleHealthReport } from '@/codebase-health/assemble.js';

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

function input(over: Partial<HealthAssemblyInput> = {}): HealthAssemblyInput {
  return {
    workflow: 'codebase-health',
    now: new Date(2026, 6, 14, 9, 0, 0),
    offline: true,
    stack: { primary: 'node', traits: [], toolchains: ['node'] },
    availability: [{ tool: 'osv-scanner', available: false, used_for: ['vulnerable-dependency'] }],
    index: index(),
    vulnRecords: [],
    secretMatches: [
      { file: 'a.ts', line: 1, rule: 'aws', fingerprint: 'fp', source: 'builtin-regex' },
    ],
    duplicationClusters: [],
    deprecationRecords: [],
    staleDocCandidates: [],
    blockedChecks: [],
    baseline: null,
    ...over,
  };
}

describe('assembleHealthReport', () => {
  it('runs detectors, assigns HL- ids, and derives sources_used', () => {
    const { report, findingIds } = assembleHealthReport(input());
    expect(report.findings.length).toBeGreaterThan(0);
    expect(findingIds.every((id) => id.startsWith('HL-'))).toBe(true);
    expect(report.report_id).toMatch(/^HEALTH-/);
    expect(report.sources_used).toContain('code-knowledge index');
    expect(report.sources_used).toContain('built-in regex secret scan');
    expect(report.report_path).toBe('docs/health/2026-07-14-09-00-00.md');
  });

  it('honours an explicit sources_used override and lists available tools otherwise', () => {
    const explicit = assembleHealthReport(input({ sourcesUsed: ['manual source'] }));
    expect(explicit.report.sources_used).toEqual(['manual source']);

    const derived = assembleHealthReport(
      input({
        secretMatches: [],
        availability: [{ tool: 'gitleaks', available: true, used_for: ['secret-leak'] }],
      }),
    );
    expect(derived.report.sources_used).toContain('gitleaks');
  });

  it('skips index-backed categories when the index is null', () => {
    const { report } = assembleHealthReport(input({ index: null }));
    expect(report.findings.some((f) => f.category === 'dead-code')).toBe(false);
    expect(report.findings.some((f) => f.category === 'unused-dependency')).toBe(false);
  });

  it('computes the baseline split and uses retest naming for a retest workflow', () => {
    const baseline = {
      schema_version: '1' as const,
      generated_by: 'paqad-ai' as const,
      framework_version: '1',
      created_at: 'x',
      finding_ids: [] as string[],
    };
    const { report } = assembleHealthReport(
      input({ workflow: 'health-retest', sourceReportId: 'HEALTH-2026-01-01-00-00-00', baseline }),
    );
    expect(report.report_id).toMatch(/^RETEST-/);
    expect(report.report_path).toContain('2026-01-01-00-00-00-retest-2026-07-14-09-00-00.md');
    // Nothing in the baseline id set → everything counts as new-since-baseline.
    expect(report.baseline.new_since_baseline).toBe(report.findings.length);
    expect(report.baseline.existed).toBe(true);
  });
});
