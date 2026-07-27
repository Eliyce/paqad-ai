import { describe, expect, it } from 'vitest';

import type { AppMap } from '@/core/types/site-map.js';
import type { SiteMapBaseline } from '@/core/types/site-map-run.js';
import {
  assembleSiteMapReport,
  detectUnmappedSurfaces,
  type SiteMapAssemblyInput,
} from '@/site-map/assemble.js';
import type { ExtractedSurface, ExtractionResult } from '@/site-map/extraction.js';

function extracted(overrides: Partial<ExtractedSurface> = {}): ExtractedSurface {
  return {
    raw_id: 'node-cli-a',
    kind: 'cli-command',
    label: 'A',
    evidence: [{ file: 'a.ts', line: 1 }],
    derivation: 'static',
    confidence: 'high',
    source: 'node-cli',
    ...overrides,
  };
}

function extraction(surfaces: ExtractedSurface[]): ExtractionResult {
  return {
    schema_version: 1,
    app_kind: 'cli',
    surfaces,
    blocked_checks: [],
    fingerprint: 'abc123abc123',
    extractors_ran: 1,
    low_confidence_fallback: false,
  };
}

function mapWith(evidence: AppMap['surfaces'][number]['evidence']): AppMap {
  return {
    schema_version: 1,
    app: { name: 'paqad-ai', kind: 'cli' },
    surfaces: [{ id: 's-a', kind: 'cli-command', label: 'A', evidence }],
  };
}

function input(overrides: Partial<SiteMapAssemblyInput> = {}): SiteMapAssemblyInput {
  return {
    workflow: 'site-map',
    now: new Date(2026, 0, 2, 3, 4, 5),
    app: { name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] },
    map: null,
    extraction: extraction([extracted()]),
    journeyCount: 0,
    blockedChecks: [],
    baseline: null,
    sources: ['node-cli'],
    ...overrides,
  };
}

describe('detectUnmappedSurfaces', () => {
  it('flags every extracted surface when there is no map', () => {
    const findings = detectUnmappedSurfaces(null, extraction([extracted()]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('SM-ADD');
    expect(findings[0]!.severity).toBe('medium');
    expect(findings[0]!.affected_surfaces).toEqual(['node-cli-a']);
    expect(findings[0]!.evidence).toEqual(['node-cli extractor — a.ts:1']);
  });

  it('treats a surface as mapped when the map cites overlapping file:line evidence', () => {
    const findings = detectUnmappedSurfaces(
      mapWith([{ file: 'a.ts', line: 1 }]),
      extraction([extracted()]),
    );
    expect(findings).toEqual([]);
  });

  it('matches on file alone when either side omits the line', () => {
    const findings = detectUnmappedSurfaces(
      mapWith([{ file: 'c.ts', line: 5 }]),
      extraction([extracted({ raw_id: 'node-cli-c', evidence: [{ file: 'c.ts' }] })]),
    );
    expect(findings).toEqual([]);
  });

  it('does not match when the evidence files differ', () => {
    const findings = detectUnmappedSurfaces(
      mapWith([{ file: 'other.ts', line: 1 }]),
      extraction([extracted()]),
    );
    expect(findings).toHaveLength(1);
  });

  it('does not match when both lines are present but disagree', () => {
    const findings = detectUnmappedSurfaces(
      mapWith([{ file: 'a.ts', line: 2 }]),
      extraction([extracted({ evidence: [{ file: 'a.ts', line: 1 }] })]),
    );
    expect(findings).toHaveLength(1);
  });

  it('grades a generic (medium-confidence) surface as low severity and drops the line from proof', () => {
    const findings = detectUnmappedSurfaces(
      null,
      extraction([
        extracted({
          raw_id: 'generic-b',
          confidence: 'medium',
          source: 'generic',
          evidence: [{ file: 'b.ts' }],
        }),
      ]),
    );
    expect(findings[0]!.severity).toBe('low');
    expect(findings[0]!.evidence).toEqual(['generic extractor — b.ts']);
  });

  it('de-duplicates and sorts affected files across a surface with multiple evidence pointers', () => {
    const findings = detectUnmappedSurfaces(
      null,
      extraction([
        extracted({
          evidence: [
            { file: 'z.ts', line: 2 },
            { file: 'z.ts', line: 9 },
            { file: 'a.ts', line: 1 },
          ],
        }),
      ]),
    );
    expect(findings[0]!.affected_files).toEqual(['a.ts', 'z.ts']);
  });

  it('treats a map surface with no evidence as covering nothing', () => {
    const map: AppMap = {
      schema_version: 1,
      app: { name: 'x', kind: 'cli' },
      surfaces: [{ id: 's', kind: 'cli-command', label: 'S' }],
    };
    expect(detectUnmappedSurfaces(map, extraction([extracted()]))).toHaveLength(1);
  });

  it('accepts a single (non-array) evidence pointer on a map surface', () => {
    const map: AppMap = {
      schema_version: 1,
      app: { name: 'x', kind: 'cli' },
      surfaces: [{ id: 's', kind: 'cli-command', label: 'S', evidence: { file: 'a.ts', line: 1 } }],
    };
    expect(detectUnmappedSurfaces(map, extraction([extracted()]))).toEqual([]);
  });
});

describe('assembleSiteMapReport', () => {
  it('produces a schema-versioned report with a deterministic id and paths', () => {
    const { report, findings, findingIds } = assembleSiteMapReport(input());
    expect(report.schema_version).toBe('1');
    expect(report.report_id).toBe('SITEMAP-2026-01-02-03-04-05');
    expect(report.report_path).toBe('docs/site-map/2026-01-02-03-04-05.md');
    expect(report.sidecar_path).toBe('docs/site-map/2026-01-02-03-04-05.json');
    expect(report.bundle_dir).toBe('.paqad/site-map/runs/SITEMAP-2026-01-02-03-04-05');
    expect(report.generated_at).toBe(new Date(2026, 0, 2, 3, 4, 5).toISOString());
    expect(report.findings).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(findingIds).toEqual(findings.map((f) => f.id));
    expect(report.source_report_path).toBeNull();
    expect(report.source_report_id).toBeNull();
  });

  it('counts mapped surfaces from the map and extracted surfaces from the extraction', () => {
    const report = assembleSiteMapReport(
      input({ map: mapWith([{ file: 'a.ts', line: 1 }]), journeyCount: 4 }),
    ).report;
    expect(report.surface_count).toBe(1);
    expect(report.journey_count).toBe(4);
    expect(report.extraction.extracted_surfaces).toBe(1);
    expect(report.findings).toEqual([]); // the one surface is mapped
  });

  it('reports zero mapped surfaces when no map exists', () => {
    expect(assembleSiteMapReport(input()).report.surface_count).toBe(0);
  });

  it('assigns the same finding id across two runs over identical inputs (AC-5)', () => {
    const a = assembleSiteMapReport(input()).findingIds;
    const b = assembleSiteMapReport(input()).findingIds;
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^SM-[0-9A-F]{8}$/);
  });

  it('marks findings against a baseline and counts the split', () => {
    const first = assembleSiteMapReport(input());
    const baseline: SiteMapBaseline = {
      schema_version: '1',
      generated_by: 'paqad-ai',
      framework_version: 'test',
      created_at: '2026-01-01T00:00:00.000Z',
      finding_ids: first.findingIds,
    };
    // Same surface stays pre-existing; a second, new surface is new-since-baseline.
    const report = assembleSiteMapReport(
      input({
        baseline,
        extraction: extraction([
          extracted(),
          extracted({
            raw_id: 'node-cli-new',
            label: 'New',
            evidence: [{ file: 'new.ts', line: 3 }],
          }),
        ]),
      }),
    ).report;
    expect(report.baseline.existed).toBe(true);
    expect(report.baseline.pre_existing).toBe(1);
    expect(report.baseline.new_since_baseline).toBe(1);
  });

  it('leaves the baseline split at zero on a first run (no baseline)', () => {
    const report = assembleSiteMapReport(input()).report;
    expect(report.baseline).toEqual({ existed: false, new_since_baseline: 0, pre_existing: 0 });
  });

  it('de-duplicates and sorts sources_used', () => {
    const report = assembleSiteMapReport(
      input({ sources: ['node-cli', 'app-map.yaml', 'node-cli'] }),
    ).report;
    expect(report.sources_used).toEqual(['app-map.yaml', 'node-cli']);
  });

  it('carries through source-report provenance when supplied', () => {
    const report = assembleSiteMapReport(
      input({ sourceReportPath: 'docs/site-map/prior.json', sourceReportId: 'SITEMAP-prior' }),
    ).report;
    expect(report.source_report_path).toBe('docs/site-map/prior.json');
    expect(report.source_report_id).toBe('SITEMAP-prior');
  });

  it('lists a placeholder remediation priority when there are no findings', () => {
    const report = assembleSiteMapReport(
      input({ map: mapWith([{ file: 'a.ts', line: 1 }]) }),
    ).report;
    expect(report.next_remediation_priorities).toEqual(['No findings recorded.']);
  });
});
