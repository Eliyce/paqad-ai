import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppMap } from '@/core/types/site-map.js';
import type { SiteMapReportIndex } from '@/core/types/site-map-run.js';
import { readBaseline } from '@/site-map/baseline.js';
import {
  blockedExtractor,
  type ExtractedSurface,
  type ExtractorOutput,
} from '@/site-map/extraction.js';
import { SITE_MAP_RUN_DOC_TYPE } from '@/site-map/ledger.js';
import { runSiteMapAudit, type SiteMapGatherer } from '@/site-map/run.js';
import { readAllSessionRows } from '@/session-ledger/ledger.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-run-'));
}

function surface(overrides: Partial<ExtractedSurface> = {}): ExtractedSurface {
  return {
    raw_id: 'node-cli-sitemap',
    kind: 'cli-command',
    label: 'Site map',
    evidence: [{ file: 'src/cli/sitemap.ts', line: 12 }],
    derivation: 'static',
    confidence: 'high',
    source: 'node-cli',
    ...overrides,
  };
}

const coveringMap: AppMap = {
  schema_version: 1,
  app: { name: 'paqad-ai', kind: 'cli' },
  surfaces: [
    {
      id: 's',
      kind: 'cli-command',
      label: 'Site map',
      evidence: [{ file: 'src/cli/sitemap.ts', line: 12 }],
    },
  ],
};

function gatherer(overrides: Partial<SiteMapGatherer> = {}): SiteMapGatherer {
  return {
    appKind: () => 'cli',
    appSummary: () => ({ name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] }),
    loadAppMap: () => null,
    journeyCount: () => 0,
    extractors: async (): Promise<ExtractorOutput[]> => [
      { extractor: 'node-cli', available: true, surfaces: [surface()] },
    ],
    ...overrides,
  };
}

function readSidecar(root: string, path: string): SiteMapReportIndex {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as SiteMapReportIndex;
}

describe('runSiteMapAudit', () => {
  it('runs offline through a fake gatherer, dual-writes the report, and creates the baseline (AC-4)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-run',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });

    expect(result.report_id).toBe('SITEMAP-2026-01-02-03-04-05');
    expect(result.exit_code).toBe(1); // no map → the surface is an SM-ADD
    expect(result.finding_count).toBe(1);
    expect(result.baseline_created).toBe(true);
    expect(result.blocked_checks).toEqual([]);

    const sidecar = readSidecar(root, result.sidecar_path);
    expect(sidecar.report_id).toBe(result.report_id);
    expect(sidecar.findings).toHaveLength(1);
    expect(sidecar.sources_used).toEqual(['node-cli']);

    expect(existsSync(join(root, result.report_path))).toBe(true);
    expect(readFileSync(join(root, result.report_path), 'utf8')).toContain(result.report_id);

    const findingIndex = JSON.parse(
      readFileSync(join(root, result.bundle_dir, 'finding-index.json'), 'utf8'),
    );
    expect(findingIndex.report_id).toBe(result.report_id);
    expect(findingIndex.findings).toHaveLength(1);
    const extraction = JSON.parse(
      readFileSync(join(root, result.bundle_dir, 'extraction.json'), 'utf8'),
    );
    expect(extraction.surfaces).toHaveLength(1);

    expect(readBaseline(root)).not.toBeNull();
  });

  it('writes a single site-map-run ledger row so the run flows into audit export (AC-6)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-ledger',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const rows = readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report_id).toBe(result.report_id);
    expect(rows[0]!.event_status).toBe('findings');
  });

  it('exits clean over a covering map and records app-map + journeys as sources (AC-8)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => coveringMap, journeyCount: () => 2 }),
      sessionId: 's-clean',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.exit_code).toBe(0);
    expect(result.finding_count).toBe(0);

    const sidecar = readSidecar(root, result.sidecar_path);
    expect(sidecar.surface_count).toBe(1);
    expect(sidecar.journey_count).toBe(2);
    expect(sidecar.sources_used).toEqual(['app-map.yaml', 'journeys', 'node-cli']);
    expect(readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE)[0]!.event_status).toBe('clean');
  });

  it('reuses an existing baseline on a later run and marks the finding pre-existing', async () => {
    const root = repo();
    await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-1',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const second = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-2',
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });
    expect(second.baseline_created).toBe(false);
    const sidecar = readSidecar(root, second.sidecar_path);
    expect(sidecar.baseline.existed).toBe(true);
    expect(sidecar.baseline.pre_existing).toBe(1);
    expect(sidecar.baseline.new_since_baseline).toBe(0);
  });

  it('defaults the clock and workflow, and carries source-report provenance when supplied', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-defaults',
      workflow: 'site-map-retest',
      sourceReportPath: 'docs/site-map/prior.json',
      sourceReportId: 'SITEMAP-prior',
      // now omitted → the real-time default clock is used.
    });
    const sidecar = readSidecar(root, result.sidecar_path);
    expect(sidecar.workflow).toBe('site-map-retest');
    expect(sidecar.source_report_path).toBe('docs/site-map/prior.json');
    expect(sidecar.source_report_id).toBe('SITEMAP-prior');
  });

  it('records a blocked extractor as a gap and still completes the run (FR-3)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        extractors: async () => [blockedExtractor('rails-routes', 'ruby missing', 'Install Ruby')],
      }),
      sessionId: 's-blocked',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.exit_code).toBe(0); // nothing extracted → no findings
    expect(result.blocked_checks).toHaveLength(1);
    const sidecar = readSidecar(root, result.sidecar_path);
    expect(sidecar.extraction.low_confidence_fallback).toBe(true);
    expect(sidecar.blocked_checks[0]!.check).toBe('rails-routes surface extraction');
  });
});
