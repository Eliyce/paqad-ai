import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppFreshness } from '@/core/types/site-map.js';
import { hashSourceFiles } from '@/document/staleness.js';
import { writeCanonicalSiteMap } from '@/site-map/store.js';
import { SiteMapFreshnessGate } from '@/verification/gates/site-map-freshness.js';

import { createVerificationContext } from '../shared.fixture.js';

const gate = new SiteMapFreshnessGate();

/** Write a stored canonical map carrying (or omitting) a stamped freshness verdict. */
function seedCanonicalMap(projectRoot: string, freshness?: AppFreshness): void {
  writeCanonicalSiteMap(projectRoot, {
    schema_version: 1,
    app: { name: 'x', kind: 'cli', ...(freshness === undefined ? {} : { freshness }) },
    surfaces: [{ id: 's', kind: 'page', label: 'S' }],
  });
}

/** Turn the site_map capability on for the temp project (local dev config, LOCAL WINS). */
function enableSiteMap(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(join(projectRoot, '.paqad/.config'), 'site_map=true\n');
}

/** Seed the site-map progress ledger with one published view (issue #448 — its own store). */
function seedSiteMapProgress(
  projectRoot: string,
  entry: { output_path: string; source_files: string[]; source_hash: string | null },
): void {
  mkdirSync(join(projectRoot, '.paqad/site-map'), { recursive: true });
  const progress = {
    schema_version: 1,
    generated_by: 'paqad-ai',
    views: {
      [entry.output_path]: {
        path: entry.output_path,
        state: 'done',
        started_at: '2026-07-27T00:00:00.000Z',
        completed_at: '2026-07-27T00:00:00.000Z',
        source_files: entry.source_files,
        source_hash: entry.source_hash,
        tokens_used: 10,
      },
    },
  };
  writeFileSync(
    join(projectRoot, '.paqad/site-map/progress.json'),
    `${JSON.stringify(progress)}\n`,
  );
}

describe('SiteMapFreshnessGate', () => {
  it('is inert when the site_map capability is off (INV-1)', async () => {
    const context = createVerificationContext({ code_changed: true });
    const result = await gate.check(context);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('off');
  });

  it('passes when the flag is on but no code changed', async () => {
    const context = createVerificationContext({ code_changed: false });
    enableSiteMap(context.project_root);
    const result = await gate.check(context);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('No code change');
  });

  it('passes when the flag is on, code changed, and nothing has been published yet', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
    const result = await gate.check(context);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('current');
  });

  it('fails when a published view is stale for the changed code', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
    writeFileSync(join(context.project_root, 'source.ts'), 'export const routes = [];\n');
    seedSiteMapProgress(context.project_root, {
      output_path: 'docs/site-map/index.md',
      source_files: ['source.ts'],
      source_hash: 'sha1:0000000',
    });

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('docs/site-map/index.md');
    expect(result.remediation).toContain('Site map area');
    expect(result.remediation).not.toContain('paqad-ai sitemap run');
  });

  it('passes when the published view still matches its sources', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
    writeFileSync(join(context.project_root, 'source.ts'), 'export const routes = [];\n');
    const currentHash = await hashSourceFiles(context.project_root, ['source.ts']);
    seedSiteMapProgress(context.project_root, {
      output_path: 'docs/site-map/index.md',
      source_files: ['source.ts'],
      source_hash: currentHash,
    });

    const result = await gate.check(context);

    expect(result.passed).toBe(true);
    expect(result.detail).toContain('current');
  });

  it('fails when the stored map has drifted from code (stamped anchors broken)', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
    seedCanonicalMap(context.project_root, {
      anchors_total: 6,
      anchors_resolved: 4,
      anchors_broken: 2,
    });

    const result = await gate.check(context);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain('drifted from code');
    expect(result.detail).toContain('2 of 6');
    expect(result.remediation).toContain('Site map area');
  });

  it('passes when the stored map is stamped fresh (no broken anchors)', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
    seedCanonicalMap(context.project_root, {
      anchors_total: 3,
      anchors_resolved: 3,
      anchors_broken: 0,
    });

    const result = await gate.check(context);

    expect(result.passed).toBe(true);
    expect(result.detail).toContain('current');
  });

  it('passes when the stored map carries no stamped freshness yet', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
    seedCanonicalMap(context.project_root);

    const result = await gate.check(context);

    expect(result.passed).toBe(true);
    expect(result.detail).toContain('current');
  });
});
