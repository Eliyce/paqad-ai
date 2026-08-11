import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppFreshness } from '@/core/types/site-map.js';
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

  it('passes when the flag is on, code changed, and no map is stored yet', async () => {
    const context = createVerificationContext({ code_changed: true });
    enableSiteMap(context.project_root);
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
