import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { DocProgressFile } from '@/core/types/document-generation.js';
import type { AppMap } from '@/core/types/site-map.js';
import { DocumentProgressTracker } from '@/document/progress-tracker.js';
import { publishSiteMap } from '@/site-map/publish.js';

import { validAppMap } from '../../fixtures/site-map/valid-app-map.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-publish-'));
}

function readProgress(root: string): DocProgressFile {
  return JSON.parse(readFileSync(join(root, PATHS.DOC_PROGRESS), 'utf8')) as DocProgressFile;
}

describe('publishSiteMap', () => {
  it('writes every derived view and registers it in the doc tracker (FR-8)', async () => {
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

    // And each is registered under the tracker's `siteMap` group as done, with a hash.
    const group = readProgress(root).global.siteMap!;
    const index = group[PATHS.SITE_MAP_INDEX]!;
    expect(index.state).toBe('done');
    expect(index.completed_at).toBe(new Date(2026, 0, 2, 3, 4, 5).toISOString());
    expect(index.source_hash).toMatch(/^sha1:/);
    expect(index.source_files).toEqual([PATHS.SITE_MAP_APP_MAP]);
    expect(index.tokens_used).toBeGreaterThan(0);
  });

  it('skips unchanged views on a second run (differential refresh)', async () => {
    const root = repo();
    const first = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(first.skipped).toEqual([]);

    // Second run over the identical map — no clock, default tracker: every view is up to date.
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
    const group = readProgress(root).global.siteMap!;
    expect(group[PATHS.SITE_MAP_INDEX]!.started_at).toBe(
      new Date(2026, 0, 2, 3, 4, 5).toISOString(),
    );
  });

  it('accepts an injected tracker and the default clock', async () => {
    const root = repo();
    const tracker = new DocumentProgressTracker();
    const result = await publishSiteMap({
      projectRoot: root,
      map: validAppMap(),
      journeyCount: 2,
      tracker,
    });
    expect(result.published.length).toBe(3);
    expect(readProgress(root).global.siteMap![PATHS.SITE_MAP_INDEX]!.completed_at).not.toBeNull();
  });

  it('deletes and de-registers a view the map no longer produces (stale-view cleanup)', async () => {
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
    expect(readProgress(root).global.siteMap![PATHS.SITE_MAP_SCREEN_REGISTRY]).toBeUndefined();
  });
});
