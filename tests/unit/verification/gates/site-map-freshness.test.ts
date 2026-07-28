import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashSourceFiles } from '@/document/staleness.js';
import { SiteMapFreshnessGate } from '@/verification/gates/site-map-freshness.js';

import { createVerificationContext } from '../shared.fixture.js';

const gate = new SiteMapFreshnessGate();

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
    expect(result.remediation).toContain('paqad-ai sitemap run');
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
});
