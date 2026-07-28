import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { SiteMapProgressFile } from '@/core/types/site-map-progress.js';
import type { AppMap } from '@/core/types/site-map.js';
import { publishSiteMap } from '@/site-map/publish.js';

import { validAppMap } from '../../fixtures/site-map/valid-app-map.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-publish-'));
}

function readProgress(root: string): SiteMapProgressFile {
  return JSON.parse(
    readFileSync(join(root, PATHS.SITE_MAP_PROGRESS), 'utf8'),
  ) as SiteMapProgressFile;
}

describe('publishSiteMap', () => {
  it('writes every derived view and records it in the site-map ledger (FR-1/FR-4)', async () => {
    const root = repo();
    const result = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });

    expect(result.published.sort()).toEqual(
      [PATHS.SITE_MAP_INDEX, PATHS.SITE_MAP_OVERVIEW, PATHS.SITE_MAP_SCREEN_REGISTRY].sort(),
    );
    expect(result.skipped).toEqual([]);

    // The views landed on disk.
    expect(readFileSync(join(root, PATHS.SITE_MAP_INDEX), 'utf8')).toContain('site map index');
    expect(readFileSync(join(root, PATHS.SITE_MAP_OVERVIEW), 'utf8')).toContain('flowchart LR');

    // And each is recorded in the site-map progress ledger as done, with a hash.
    const views = readProgress(root).views;
    const index = views[PATHS.SITE_MAP_INDEX]!;
    expect(index.state).toBe('done');
    expect(index.completed_at).toBe(new Date(2026, 0, 2, 3, 4, 5).toISOString());
    expect(index.source_hash).toMatch(/^sha1:/);
    expect(index.source_files).toEqual([PATHS.SITE_MAP_APP_MAP]);
    expect(index.tokens_used).toBeGreaterThan(0);
  });

  it('never reads doc-progress.json — a legacy/invalid one does not block publication (AC-1/INV-2)', async () => {
    const root = repo();
    // A doc-progress.json from an older paqad, in a shape the current validator rejects.
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.DOC_PROGRESS),
      JSON.stringify({ version: 1, stage: 'module-docs', completed: [] }) + '\n',
    );

    const result = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });

    // Publication still happens — the legacy doc-progress is irrelevant to the site-map run.
    expect(result.published.length).toBe(3);
    expect(existsSync(join(root, PATHS.SITE_MAP_INDEX))).toBe(true);
    // And the legacy doc-progress.json is left exactly as it was (never read, never rewritten).
    expect(JSON.parse(readFileSync(join(root, PATHS.DOC_PROGRESS), 'utf8'))).toEqual({
      version: 1,
      stage: 'module-docs',
      completed: [],
    });
  });

  it('degrades a corrupt site-map ledger to empty and self-heals (INV-3)', async () => {
    const root = repo();
    mkdirSync(join(root, '.paqad/site-map'), { recursive: true });
    writeFileSync(join(root, PATHS.SITE_MAP_PROGRESS), '{ not valid json');

    const result = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });

    // The corrupt ledger did not crash the publisher; every view re-published and the ledger
    // was rewritten into a valid shape.
    expect(result.published.length).toBe(3);
    expect(readProgress(root).schema_version).toBe(1);
    expect(readProgress(root).views[PATHS.SITE_MAP_INDEX]!.state).toBe('done');
  });

  it('skips unchanged views on a second run (differential refresh, FR-6)', async () => {
    const root = repo();
    const first = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(first.skipped).toEqual([]);

    // Second run over the identical map — no clock: every view is up to date.
    const second = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
    });
    expect(second.published).toEqual([]);
    expect(second.skipped.sort()).toEqual(
      [PATHS.SITE_MAP_INDEX, PATHS.SITE_MAP_OVERVIEW, PATHS.SITE_MAP_SCREEN_REGISTRY].sort(),
    );
    // started_at is preserved from the first run, not overwritten.
    const views = readProgress(root).views;
    expect(views[PATHS.SITE_MAP_INDEX]!.started_at).toBe(
      new Date(2026, 0, 2, 3, 4, 5).toISOString(),
    );
  });

  it('deletes and de-registers a view the map no longer produces (stale-view cleanup, FR-6)', async () => {
    const root = repo();
    // First: a map with screen surfaces → a screen-registry is published.
    await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 0,
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(existsSync(join(root, PATHS.SITE_MAP_SCREEN_REGISTRY))).toBe(true);

    // Then: a map with no screen-family surfaces → the screen-registry is no longer produced.
    const noScreens: AppMap = {
      schema_version: 1,
      app: { name: 'cli-only', kind: 'cli' },
      surfaces: [
        {
          id: 'c',
          kind: 'cli-command',
          label: 'Run',
          evidence: [{ file: 'src/cli.ts', line: 1 }],
        },
      ],
    };
    const result = await publishSiteMap({
      projectRoot: root,
      map: noScreens,
      journeyCount: 0,
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });

    expect(result.removed).toContain(PATHS.SITE_MAP_SCREEN_REGISTRY);
    expect(existsSync(join(root, PATHS.SITE_MAP_SCREEN_REGISTRY))).toBe(false);
    expect(readProgress(root).views[PATHS.SITE_MAP_SCREEN_REGISTRY]).toBeUndefined();
  });
});
