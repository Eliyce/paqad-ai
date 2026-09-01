import { describe, expect, it } from 'vitest';

import type { AppMap } from '@/core/types/site-map.js';
import type { SiteMapBaseline } from '@/core/types/site-map-run.js';
import {
  assembleSiteMapReport,
  detectMissingEdges,
  detectUnmappedSurfaces,
  type SiteMapAssemblyInput,
} from '@/site-map/assemble.js';
import type { ExtractedSurface, ExtractionResult } from '@/site-map/extraction.js';
import type { ExtractedTransition } from '@/site-map/transitions.js';

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
    evidenceResolutions: [],
    codeTransitions: [],
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
  it('produces a schema-versioned report with a deterministic id and bundle dir', () => {
    const { report, findings, findingIds } = assembleSiteMapReport(input());
    expect(report.schema_version).toBe('1');
    expect(report.report_id).toBe('SITEMAP-2026-01-02-03-04-05');
    expect(report.bundle_dir).toBe('.paqad/site-map/runs/SITEMAP-2026-01-02-03-04-05');
    expect(report.generated_at).toBe(new Date(2026, 0, 2, 3, 4, 5).toISOString());
    expect(report.findings).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(findingIds).toEqual(findings.map((f) => f.id));
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

  it('folds an overstated trust tier into the findings as SM-TRUST', () => {
    // A surface claiming proven-in-code whose cited file is gone: the trust proof catches it
    // alongside the evidence check, so both categories reach the assembled report.
    const map: AppMap = {
      schema_version: 1,
      app: { name: 'paqad-ai', kind: 'cli' },
      surfaces: [
        {
          id: 's-a',
          kind: 'cli-command',
          label: 'A',
          trust: 'proven-in-code',
          evidence: [{ file: 'gone.ts', line: 1 }],
        },
      ],
    };
    const { findings } = assembleSiteMapReport(
      input({ map, evidenceResolutions: [{ file: 'gone.ts', line: 1, status: 'file-missing' }] }),
    );
    const categories = findings.map((finding) => finding.category);
    expect(categories).toContain('SM-TRUST');
    expect(categories).toContain('SM-REMOVE');
  });

  it('de-duplicates and sorts sources_used', () => {
    const report = assembleSiteMapReport(
      input({ sources: ['node-cli', 'app-map.yaml', 'node-cli'] }),
    ).report;
    expect(report.sources_used).toEqual(['app-map.yaml', 'node-cli']);
  });
});

// --- S9c: reconcile missing links ------------------------------------------------------------

function codeEdge(overrides: Partial<ExtractedTransition> = {}): ExtractedTransition {
  return {
    from_raw_id: 's-a',
    to_target: '/b',
    trigger: 'navigate',
    evidence: [{ file: 'src/a.ts', line: 7 }],
    confidence: 'high',
    ...overrides,
  };
}

/** A two-surface map: origin `s-a`, target `s-b` reachable at entry value `/b`. */
function twoSurfaceMap(overrides: Partial<AppMap['surfaces'][number]> = {}): AppMap {
  return {
    schema_version: 1,
    app: { name: 'paqad-ai', kind: 'cli' },
    surfaces: [
      { id: 's-a', kind: 'page', label: 'A', ...overrides },
      { id: 's-b', kind: 'page', label: 'B', entry: { kind: 'url', value: '/b' } },
    ],
  };
}

describe('detectMissingEdges', () => {
  it('raises one SM-EDGE-MISSING when the code proves an edge the origin does not record (AC-2)', () => {
    const findings = detectMissingEdges(twoSurfaceMap(), [
      { from_id: 's-a', transition: { to: 's-b', trigger: 'navigate', confidence: 'high' } },
    ]);
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.category).toBe('SM-EDGE-MISSING');
    expect(finding.title).toBe('Unmapped link: s-a → s-b');
    expect(finding.affected_surfaces).toEqual(['s-a', 's-b']);
  });

  it('raises nothing when the map already records the edge (AC-2)', () => {
    const map = twoSurfaceMap({ transitions: [{ to: 's-b', trigger: 'go' }] });
    const findings = detectMissingEdges(map, [
      { from_id: 's-a', transition: { to: 's-b', trigger: 'navigate', confidence: 'high' } },
    ]);
    expect(findings).toEqual([]);
  });

  it('matches origin+target, not trigger — a different trigger to the same target is still recorded', () => {
    const map = twoSurfaceMap({ transitions: [{ to: 's-b', trigger: 'link' }] });
    const findings = detectMissingEdges(map, [
      { from_id: 's-a', transition: { to: 's-b', trigger: 'redirect', confidence: 'high' } },
    ]);
    expect(findings).toEqual([]);
  });

  it('raises nothing when the origin surface is not on the map (SM-ADD covers it) (AC-3)', () => {
    const findings = detectMissingEdges(twoSurfaceMap(), [
      { from_id: 's-ghost', transition: { to: 's-b', trigger: 'navigate', confidence: 'high' } },
    ]);
    expect(findings).toEqual([]);
  });

  it('collapses two identical edges (same origin and target) into one finding (AC-3)', () => {
    const edge = {
      from_id: 's-a',
      transition: { to: 's-b', trigger: 'navigate', confidence: 'high' as const },
    };
    const findings = detectMissingEdges(twoSurfaceMap(), [edge, { ...edge }]);
    expect(findings).toHaveLength(1);
  });

  it('grades a high-confidence edge medium and a low-confidence edge low (AC-4)', () => {
    const map: AppMap = {
      schema_version: 1,
      app: { name: 'paqad-ai', kind: 'cli' },
      surfaces: [
        { id: 's-a', kind: 'page', label: 'A' },
        { id: 's-b', kind: 'page', label: 'B' },
        { id: 's-c', kind: 'page', label: 'C' },
      ],
    };
    const findings = detectMissingEdges(map, [
      {
        from_id: 's-a',
        transition: {
          to: 's-b',
          trigger: 'navigate',
          confidence: 'high',
          evidence: [{ file: 'a.ts', line: 1 }],
        },
      },
      {
        from_id: 's-a',
        transition: {
          to: 's-c',
          trigger: 'invoke',
          confidence: 'low',
          evidence: [{ file: 'a.ts', line: 2 }],
        },
      },
    ]);
    const byTarget = new Map(findings.map((f) => [f.affected_surfaces[1], f.severity]));
    expect(byTarget.get('s-b')).toBe('medium');
    expect(byTarget.get('s-c')).toBe('low');
  });

  it('carries the code evidence (with and without a line) and a concrete resolution', () => {
    const findings = detectMissingEdges(twoSurfaceMap(), [
      {
        from_id: 's-a',
        transition: {
          to: 's-b',
          trigger: 'navigate',
          confidence: 'high',
          evidence: [{ file: 'src/a.ts', line: 7 }, { file: 'src/b.ts' }],
        },
      },
    ]);
    expect(findings[0]!.evidence).toEqual([
      'code — src/a.ts:7 navigates s-a → s-b',
      'code — src/b.ts navigates s-a → s-b',
    ]);
    expect(findings[0]!.affected_files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(findings[0]!.resolution).toContain('"navigate" transition from "s-a" to "s-b"');
  });
});

describe('assembleSiteMapReport — edge reconciliation (S9c)', () => {
  it('adds an SM-EDGE-MISSING finding when the code proves an unrecorded resolvable edge', () => {
    const { findings } = assembleSiteMapReport(
      input({ map: twoSurfaceMap(), codeTransitions: [codeEdge()] }),
    );
    expect(findings.map((f) => f.category)).toContain('SM-EDGE-MISSING');
  });

  it('records a transition-resolution blocked check when a code edge resolves to no surface (AC-5)', () => {
    const report = assembleSiteMapReport(
      input({ map: twoSurfaceMap(), codeTransitions: [codeEdge({ to_target: '/nowhere' })] }),
    ).report;
    expect(report.blocked_checks.map((c) => c.check)).toContain('transition-resolution');
  });

  it('adds no transition-resolution blocked check when every code edge resolves (AC-5)', () => {
    const report = assembleSiteMapReport(
      input({ map: twoSurfaceMap(), codeTransitions: [codeEdge()] }),
    ).report;
    expect(report.blocked_checks.map((c) => c.check)).not.toContain('transition-resolution');
  });

  it('ignores code transitions entirely when there is no stored map (INV-4)', () => {
    const report = assembleSiteMapReport(
      input({ map: null, codeTransitions: [codeEdge({ to_target: '/nowhere' })] }),
    ).report;
    expect(report.findings.map((f) => f.category)).not.toContain('SM-EDGE-MISSING');
    expect(report.blocked_checks.map((c) => c.check)).not.toContain('transition-resolution');
  });
});
