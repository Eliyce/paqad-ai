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

  it('is disabled when the site_map flag is off, even with a map present', () => {
    writeCanonicalMap(validAppMap());
    expect(buildSiteMapView(root, FLAG_OFF)).toEqual({ status: 'disabled' });
  });

  it('is empty when the flag is on but no map has been authored', () => {
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
    expect(view.freshness).toEqual({ generated_from: 'main@abc123' });
  });

  it('reports null freshness when the map does not state the code state it was authored against', () => {
    writeCanonicalMap(minimalAppMap());
    const view = buildSiteMapView(root, FLAG_ON);
    if (view.status !== 'ready') throw new Error('expected ready');
    expect(view.freshness).toEqual({ generated_from: null });
    expect(view.journeys).toEqual([]);
  });
});
