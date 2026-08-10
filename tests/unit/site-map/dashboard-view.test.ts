import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { buildSiteMapView, canonicalAppMapPath } from '@/site-map/index.js';

import { minimalAppMap, validAppMap, validJourney } from '../../fixtures/site-map/valid-app-map.js';

const FLAG_ON: NodeJS.ProcessEnv = { PAQAD_SITE_MAP: 'true' };
const FLAG_OFF: NodeJS.ProcessEnv = { PAQAD_SITE_MAP: 'false' };

describe('buildSiteMapView (issue #466)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-view-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeCanonicalMap(map: unknown): void {
    const path = canonicalAppMapPath(root);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, YAML.stringify(map), 'utf8');
  }

  function writeCanonicalJourney(id: string, journey: unknown): void {
    const dir = join(root, PATHS.SITE_MAP_CANONICAL_JOURNEYS_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.journey.yaml`), YAML.stringify(journey), 'utf8');
  }

  /** The `create documentation` output: docs/instructions/rules/module-map.yml with one module. */
  function writeModuleMap(): void {
    const path = join(root, PATHS.MODULE_MAP);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      YAML.stringify({
        modules: [{ slug: 'billing', name: 'Billing', sources: ['src/billing/**'] }],
      }),
      'utf8',
    );
  }

  /** The `create module documentation` output for a module: docs/modules/<slug>/index/summary.md. */
  function writeModuleDoc(slug: string): void {
    const dir = join(root, PATHS.MODULES_DIR, slug, 'index');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'summary.md'), `# ${slug}\n`, 'utf8');
  }

  it('is disabled when the site_map flag is off, even with a map present', () => {
    writeCanonicalMap(validAppMap());
    expect(buildSiteMapView(root, FLAG_OFF)).toEqual({ status: 'disabled' });
  });

  it('is blocked on create documentation when the documentation foundation is absent', () => {
    const view = buildSiteMapView(root, FLAG_ON);
    expect(view.status).toBe('blocked');
    if (view.status !== 'blocked') throw new Error('expected blocked');
    expect(view.missing.map((m) => m.workflow)).toEqual(['create documentation']);
    expect(view.prerequisites.status.foundation_present).toBe(false);
  });

  it('is blocked on create module documentation when the foundation exists but no module is documented', () => {
    writeModuleMap();
    const view = buildSiteMapView(root, FLAG_ON);
    if (view.status !== 'blocked') throw new Error('expected blocked');
    expect(view.missing.map((m) => m.workflow)).toEqual(['create module documentation']);
    expect(view.prerequisites.status).toMatchObject({
      foundation_present: true,
      module_count: 1,
      documented_module_count: 0,
    });
  });

  it('is empty when the prerequisites are met but no map has been authored', () => {
    writeModuleMap();
    writeModuleDoc('billing');
    expect(buildSiteMapView(root, FLAG_ON)).toEqual({ status: 'empty' });
  });

  it('serves the full map, its journeys, and freshness when ready', () => {
    const map = validAppMap();
    writeCanonicalMap(map);
    writeCanonicalJourney('checkout', { ...validJourney(), id: 'checkout' });

    const view = buildSiteMapView(root, FLAG_ON);
    expect(view.status).toBe('ready');
    if (view.status !== 'ready') throw new Error('expected ready');
    expect(view.map).toEqual(map);
    expect(view.journeys.map((journey) => journey.id)).toEqual(['checkout']);
    // No freshness has been stamped yet, so the anchor counts are null and nothing reads stale.
    expect(view.freshness).toEqual({
      generated_from: 'main@abc123',
      anchors_total: null,
      anchors_resolved: null,
      anchors_broken: null,
      stale: false,
    });
  });

  it('reports null freshness when the map does not state the code state it was authored against', () => {
    writeCanonicalMap(minimalAppMap());
    const view = buildSiteMapView(root, FLAG_ON);
    if (view.status !== 'ready') throw new Error('expected ready');
    expect(view.freshness).toEqual({
      generated_from: null,
      anchors_total: null,
      anchors_resolved: null,
      anchors_broken: null,
      stale: false,
    });
    expect(view.journeys).toEqual([]);
  });

  it('surfaces the stamped anchor counts statically and reads fresh when every anchor resolves', () => {
    const map = validAppMap();
    writeCanonicalMap({
      ...map,
      app: { ...map.app, freshness: { anchors_total: 4, anchors_resolved: 4, anchors_broken: 0 } },
    });

    const view = buildSiteMapView(root, FLAG_ON);
    if (view.status !== 'ready') throw new Error('expected ready');
    expect(view.freshness).toEqual({
      generated_from: 'main@abc123',
      anchors_total: 4,
      anchors_resolved: 4,
      anchors_broken: 0,
      stale: false,
    });
  });

  it('reads stale when the stamped freshness shows at least one broken anchor', () => {
    const map = validAppMap();
    writeCanonicalMap({
      ...map,
      app: { ...map.app, freshness: { anchors_total: 4, anchors_resolved: 3, anchors_broken: 1 } },
    });

    const view = buildSiteMapView(root, FLAG_ON);
    if (view.status !== 'ready') throw new Error('expected ready');
    expect(view.freshness.stale).toBe(true);
    expect(view.freshness.anchors_broken).toBe(1);
  });
});
