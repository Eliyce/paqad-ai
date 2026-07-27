import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppMap } from '@/core/types/site-map.js';
import type { SiteMapReportIndex } from '@/core/types/site-map-run.js';
import { type ExtractedSurface, type ExtractorOutput } from '@/site-map/extraction.js';
import { runSiteMapRetest } from '@/site-map/retest-run.js';
import { runSiteMapAudit, type SiteMapGatherer } from '@/site-map/run.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-retest-'));
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
    resolveEvidence: (pointers) =>
      pointers.map((pointer) => ({ file: pointer.file, line: pointer.line, status: 'resolved' })),
    extractors: async (): Promise<ExtractorOutput[]> => [
      { extractor: 'node-cli', available: true, surfaces: [surface()] },
    ],
    ...overrides,
  };
}

/** Seed a source report by running a real audit (no map → one SM-ADD finding). */
async function seedSource(root: string): Promise<string> {
  const run = await runSiteMapAudit({
    projectRoot: root,
    gatherer: gatherer(),
    now: () => new Date(2026, 0, 2, 3, 4, 5),
  });
  return run.sidecar_path;
}

describe('runSiteMapRetest', () => {
  it('reports still-open when the same finding reproduces (defaults to the newest sidecar)', async () => {
    const root = repo();
    await seedSource(root);

    const result = await runSiteMapRetest({
      projectRoot: root,
      gatherer: gatherer(),
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.still_open).toBe(1);
    expect(result.fixed).toBe(0);
    expect(result.exit_code).toBe(1);
    expect(existsSync(join(root, result.report_path))).toBe(true);

    const sidecar = JSON.parse(
      readFileSync(join(root, result.sidecar_path), 'utf8'),
    ) as SiteMapReportIndex;
    expect(sidecar.workflow).toBe('site-map-retest');
    expect(sidecar.findings[0]!.status).toBe('still-open');
  });

  it('reports fixed when the finding no longer reproduces (explicit --sidecar)', async () => {
    const root = repo();
    const sourcePath = await seedSource(root);

    const result = await runSiteMapRetest({
      projectRoot: root,
      // A covering map means the extracted surface is mapped, so the SM-ADD is gone.
      gatherer: gatherer({ loadAppMap: () => coveringMap }),
      sidecar: sourcePath,
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixed).toBe(1);
    expect(result.still_open).toBe(0);
    expect(result.exit_code).toBe(0);
  });

  it('defaults the clock when now is omitted', async () => {
    const root = repo();
    await seedSource(root);
    const result = await runSiteMapRetest({ projectRoot: root, gatherer: gatherer() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.still_open).toBe(1);
  });

  it('fails cleanly when no prior report exists', async () => {
    const result = await runSiteMapRetest({ projectRoot: repo(), gatherer: gatherer() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no prior site-map report');
  });

  it('fails cleanly when the named sidecar is not a valid report', async () => {
    const root = repo();
    mkdirSync(join(root, 'docs/site-map'), { recursive: true });
    writeFileSync(join(root, 'docs/site-map/broken.json'), '{ not: valid');

    const result = await runSiteMapRetest({
      projectRoot: root,
      gatherer: gatherer(),
      sidecar: 'docs/site-map/broken.json',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('could not read a valid site-map sidecar');
  });
});
