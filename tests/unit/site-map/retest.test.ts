import { describe, expect, it } from 'vitest';

import type { SiteMapFinding, SiteMapReportIndex } from '@/core/types/site-map-run.js';
import { buildSiteMapRetestFindings, buildSiteMapRetestReportIndex } from '@/site-map/retest.js';

function finding(overrides: Partial<SiteMapFinding> = {}): SiteMapFinding {
  return {
    id: 'SM-11111111',
    title: 'Stale surface',
    description: 'The cited file is gone.',
    category: 'SM-REMOVE',
    severity: 'high',
    tier: 'deterministic',
    confidence: 1,
    evidence: ['src/gone.ts:3'],
    resolution: 'Remove the surface or restore the file.',
    affected_surfaces: ['s-home'],
    affected_files: ['src/gone.ts'],
    baseline_status: 'unknown',
    status: 'open',
    ...overrides,
  };
}

function sourceReport(findings: SiteMapFinding[]): SiteMapReportIndex {
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: '1.71.0',
    report_id: 'SITEMAP-2026-01-02-03-04-05',
    workflow: 'site-map',
    generated_at: '2026-01-02T03:04:05.000Z',
    report_path: 'docs/site-map/2026-01-02-03-04-05.md',
    sidecar_path: 'docs/site-map/2026-01-02-03-04-05.json',
    bundle_dir: '.paqad/site-map/runs/SITEMAP-2026-01-02-03-04-05',
    source_report_path: null,
    source_report_id: null,
    app: { name: 'paqad-ai', kind: 'cli', frameworks: [] },
    surface_count: 1,
    journey_count: 0,
    extraction: {
      extractors_ran: 1,
      extracted_surfaces: 1,
      low_confidence_fallback: false,
      fingerprint: 'sha1:abc',
    },
    findings,
    blocked_checks: [],
    baseline: { existed: true, new_since_baseline: 0, pre_existing: 1 },
    sources_used: ['node-cli'],
    next_remediation_priorities: ['SM-11111111: Stale surface'],
  };
}

describe('buildSiteMapRetestFindings', () => {
  it('marks a finding still-open when its id reproduces in the fresh scan', () => {
    const source = [finding()];
    const current = [finding()];
    const [result] = buildSiteMapRetestFindings(source, current);
    expect(result!.retest_status).toBe('still-open');
    expect(result!.status).toBe('still-open');
  });

  it('marks a deterministic finding fixed when its id is gone', () => {
    const [result] = buildSiteMapRetestFindings([finding()], []);
    expect(result!.retest_status).toBe('fixed');
  });

  it('marks an absent ai-judged finding needs-manual-verification (a re-scan cannot re-derive it)', () => {
    const aiFinding = finding({ id: 'SM-22222222', tier: 'ai-judged', confidence: 0.6 });
    const [result] = buildSiteMapRetestFindings([aiFinding], []);
    expect(result!.retest_status).toBe('needs-manual-verification');
  });

  it('preserves every source finding id', () => {
    const source = [finding({ id: 'SM-aaaaaaaa' }), finding({ id: 'SM-bbbbbbbb' })];
    const results = buildSiteMapRetestFindings(source, []);
    expect(results.map((entry) => entry.id).sort()).toEqual(['SM-aaaaaaaa', 'SM-bbbbbbbb']);
  });
});

describe('buildSiteMapRetestReportIndex', () => {
  const now = new Date(2026, 5, 1, 9, 8, 7);

  it('assembles a retest index with retest filenames and source provenance', () => {
    const source = sourceReport([finding()]);
    const retestFindings = buildSiteMapRetestFindings(source.findings, source.findings);
    const report = buildSiteMapRetestReportIndex({ now, source, retestFindings });

    expect(report.workflow).toBe('site-map-retest');
    expect(report.report_id).toBe('RETEST-2026-06-01-09-08-07');
    expect(report.report_path).toBe(
      'docs/site-map/2026-01-02-03-04-05-retest-2026-06-01-09-08-07.md',
    );
    expect(report.sidecar_path).toBe(
      'docs/site-map/2026-01-02-03-04-05-retest-2026-06-01-09-08-07.json',
    );
    expect(report.bundle_dir).toBe('.paqad/site-map/runs/RETEST-2026-06-01-09-08-07');
    expect(report.source_report_id).toBe('SITEMAP-2026-01-02-03-04-05');
    expect(report.source_report_path).toBe('docs/site-map/2026-01-02-03-04-05.json');
    expect(report.next_remediation_priorities).toEqual(['SM-11111111: Stale surface']);
  });

  it('strips a RETEST- prefix so a retest of a retest keeps the original timestamp', () => {
    const source = sourceReport([]);
    source.report_id = 'RETEST-2026-01-02-03-04-05';
    const report = buildSiteMapRetestReportIndex({ now, source, retestFindings: [] });
    expect(report.report_path).toContain('2026-01-02-03-04-05-retest-');
    expect(report.next_remediation_priorities).toEqual(['No findings recorded.']);
  });
});
