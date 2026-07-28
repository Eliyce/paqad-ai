import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { validateSiteMapProgress } from '@/site-map/schema.js';
import {
  createSiteMapProgressEntry,
  emptySiteMapProgress,
  readSiteMapProgress,
  siteMapProgressPath,
  writeSiteMapProgress,
} from '@/site-map/progress-store.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-progress-'));
}

describe('site-map progress store (issue #448)', () => {
  it('round-trips a valid ledger and reports its path', () => {
    const root = repo();
    const progress = emptySiteMapProgress();
    progress.views['docs/site-map/index.md'] = {
      ...createSiteMapProgressEntry('docs/site-map/index.md', ['src/a.ts']),
      state: 'done',
      source_hash: 'sha1:abc',
    };

    const written = writeSiteMapProgress(root, progress);
    expect(written).toBe(join(root, PATHS.SITE_MAP_PROGRESS));
    expect(siteMapProgressPath(root)).toBe(written);
    expect(readSiteMapProgress(root)).toEqual(progress);
  });

  it('emptySiteMapProgress and createSiteMapProgressEntry produce a schema-valid shape', () => {
    const progress = emptySiteMapProgress();
    progress.views['docs/site-map/overview.md'] = createSiteMapProgressEntry(
      'docs/site-map/overview.md',
      ['src/b.ts'],
    );
    expect(validateSiteMapProgress(progress).valid).toBe(true);
    const entry = progress.views['docs/site-map/overview.md']!;
    expect(entry).toMatchObject({
      path: 'docs/site-map/overview.md',
      state: 'not_started',
      started_at: null,
      completed_at: null,
      source_hash: null,
      tokens_used: null,
    });
  });

  it('reads null when the file is missing', () => {
    expect(readSiteMapProgress(repo())).toBeNull();
  });

  it('reads null when the file is corrupt JSON', () => {
    const root = repo();
    mkdirSync(join(root, '.paqad/site-map'), { recursive: true });
    writeFileSync(join(root, PATHS.SITE_MAP_PROGRESS), '{ not json');
    expect(readSiteMapProgress(root)).toBeNull();
  });

  it('reads null when the file is valid JSON but fails the schema', () => {
    const root = repo();
    mkdirSync(join(root, '.paqad/site-map'), { recursive: true });
    // Legacy doc-progress shape — wrong schema_version type + unknown keys.
    writeFileSync(
      join(root, PATHS.SITE_MAP_PROGRESS),
      JSON.stringify({ schema_version: '1', generated_by: 'paqad-ai', modules: {}, global: {} }),
    );
    expect(readSiteMapProgress(root)).toBeNull();
  });

  it('validateSiteMapProgress returns errors for an invalid shape', () => {
    const result = validateSiteMapProgress({ schema_version: 2, generated_by: 'x', views: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
