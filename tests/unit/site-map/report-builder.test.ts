import { describe, expect, it } from 'vitest';

import type {
  SiteMapFinding,
  SiteMapReportIndex,
  SiteMapRetestFinding,
} from '@/core/types/site-map-run.js';
import { buildSiteMapMarkdown, nextRemediationPriorities } from '@/site-map/report-builder.js';

function finding(overrides: Partial<SiteMapFinding> = {}): SiteMapFinding {
  return {
    id: 'SM-AAAAAAAA',
    title: 'Unmapped cli-command: sitemap',
    description: 'A surface exists in code but is absent from the map.',
    category: 'SM-ADD',
    severity: 'medium',
    tier: 'deterministic',
    confidence: 1,
    evidence: ['node-cli extractor — src/cli/sitemap.ts:12'],
    resolution: 'Add a surface for "sitemap" to the map.',
    affected_surfaces: ['node-cli-sitemap'],
    affected_files: ['src/cli/sitemap.ts'],
    baseline_status: 'new-since-baseline',
    status: 'open',
    ...overrides,
  };
}

function report(overrides: Partial<SiteMapReportIndex> = {}): SiteMapReportIndex {
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: 'test',
    report_id: 'SITEMAP-2026-01-02-03-04-05',
    workflow: 'site-map',
    generated_at: '2026-01-02T03:04:05.000Z',
    report_path: 'docs/site-map/2026-01-02-03-04-05.md',
    sidecar_path: 'docs/site-map/2026-01-02-03-04-05.json',
    bundle_dir: '.paqad/site-map/runs/SITEMAP-2026-01-02-03-04-05',
    source_report_path: null,
    source_report_id: null,
    app: { name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] },
    surface_count: 3,
    journey_count: 1,
    extraction: {
      extractors_ran: 1,
      extracted_surfaces: 4,
      low_confidence_fallback: false,
      fingerprint: 'abc123abc123',
    },
    findings: [],
    blocked_checks: [],
    baseline: { existed: true, new_since_baseline: 1, pre_existing: 0 },
    sources_used: ['node-cli'],
    next_remediation_priorities: ['No findings recorded.'],
    ...overrides,
  };
}

describe('nextRemediationPriorities', () => {
  it('returns a placeholder when there are no findings', () => {
    expect(nextRemediationPriorities([])).toEqual(['No findings recorded.']);
  });

  it('orders most-severe first and caps at five', () => {
    const findings = [
      finding({ id: 'SM-LOW', title: 'low', severity: 'low' }),
      finding({ id: 'SM-HIGH', title: 'high', severity: 'high' }),
      ...Array.from({ length: 5 }, (_, i) =>
        finding({ id: `SM-MED${i}`, title: `med${i}`, severity: 'medium' }),
      ),
    ];
    const priorities = nextRemediationPriorities(findings);
    expect(priorities).toHaveLength(5);
    expect(priorities[0]).toBe('SM-HIGH: high');
    expect(priorities).not.toContain('SM-LOW: low');
  });
});

describe('buildSiteMapMarkdown', () => {
  it('renders proven and judgment findings in separate sections with proof and fix', () => {
    const judged: SiteMapFinding = finding({
      id: 'SM-BBBBBBBB',
      title: 'Guard drift on /admin',
      category: 'SM-GUARD-DRIFT',
      tier: 'ai-judged',
      confidence: 0.62,
      baseline_status: 'unknown',
      affected_surfaces: [],
    });
    const md = buildSiteMapMarkdown(
      report({
        findings: [finding(), judged],
        next_remediation_priorities: ['SM-AAAAAAAA: Unmapped cli-command: sitemap'],
      }),
    );
    expect(md).toContain('# SITEMAP-2026-01-02-03-04-05');
    expect(md).toContain('- App: paqad-ai (cli)');
    expect(md).toContain('## Proven');
    expect(md).toContain('### SM-AAAAAAAA — Unmapped cli-command: sitemap');
    expect(md).toContain('- Baseline: new-since-baseline');
    expect(md).toContain('Affected surfaces: node-cli-sitemap');
    expect(md).toContain('Fix: Add a surface for "sitemap" to the map.');
    expect(md).toContain('## Needs judgment');
    expect(md).toContain('- Confidence: 0.62 (needs your judgment)');
    // The judged finding has no baseline status and no affected surfaces → those lines are absent.
    expect(md).not.toContain('- Baseline: unknown');
    expect(md).toContain('_Every extractor ran._');
  });

  it('renders a retest verdict line and the retest-of header', () => {
    const retest: SiteMapRetestFinding = { ...finding(), retest_status: 'still-open' };
    const md = buildSiteMapMarkdown(
      report({
        findings: [retest],
        source_report_id: 'SITEMAP-prior',
        source_report_path: 'docs/site-map/prior.json',
      }),
    );
    expect(md).toContain('- Retest of: SITEMAP-prior');
    expect(md).toContain('- Retest: still-open');
  });

  it('renders empty sections and blocked checks honestly', () => {
    const md = buildSiteMapMarkdown(
      report({
        findings: [],
        blocked_checks: [
          {
            check: 'rails-routes surface extraction',
            reason: 'ruby missing',
            install_hint: 'Install Ruby',
          },
        ],
      }),
    );
    expect(md).toContain('## Proven\n\n_None._');
    expect(md).toContain('## Needs judgment\n\n_None._');
    expect(md).toContain('- rails-routes surface extraction: ruby missing — Install Ruby');
    expect(md).not.toContain('- Retest of:');
  });
});
