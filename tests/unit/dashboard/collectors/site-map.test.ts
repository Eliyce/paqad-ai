import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { AppFreshness } from '@/core/types/site-map.js';
import { collectSiteMap } from '@/dashboard/collectors/site-map.js';
import { writeCanonicalSiteMap } from '@/site-map/index.js';

import { validAppMap, validJourney } from '../../../fixtures/site-map/valid-app-map.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'sm-dash-'));
}

function writeMap(root: string, freshness?: AppFreshness): void {
  const map = validAppMap();
  if (freshness !== undefined) {
    map.app.freshness = freshness;
  }
  writeCanonicalSiteMap(root, map);
}

describe('collectSiteMap', () => {
  it('is an unknown, empty section when there is no stored map', () => {
    const { section, attention } = collectSiteMap(repo());
    expect(section.id).toBe('site-map');
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(section.summary).toContain('No site map yet');
    expect(attention).toEqual([]);
  });

  it('reads a never-checked map honestly: counts present, freshness unknown', () => {
    const root = repo();
    writeMap(root);
    const { section, attention } = collectSiteMap(root);
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(section.summary).toContain('not yet checked against code');
    expect(section.metrics.find((m) => m.label === 'surfaces')?.value).toBe(
      String(validAppMap().surfaces.length),
    );
    expect(section.metrics.find((m) => m.label === 'anchors checked')?.value).toBe('—');
    expect(attention).toEqual([]);
  });

  it('scores a checked, fresh map from its resolving anchors and counts canonical journeys', () => {
    const root = repo();
    writeMap(root, { anchors_total: 6, anchors_resolved: 6, anchors_broken: 0 });
    const journey = validJourney();
    const journeysDir = join(root, PATHS.SITE_MAP_CANONICAL_JOURNEYS_DIR);
    mkdirSync(journeysDir, { recursive: true });
    writeFileSync(join(journeysDir, `${journey.id}.journey.yaml`), YAML.stringify(journey), 'utf8');
    const { section, attention } = collectSiteMap(root);
    expect(section.score).toBe(100);
    expect(section.summary).toContain('6 of 6 anchors resolve');
    expect(section.metrics.find((m) => m.label === 'journeys')?.value).toBe('1');
    expect(section.metrics.find((m) => m.label === 'broken anchors')?.value).toBe('0');
    expect(attention).toEqual([]);
  });

  it('raises attention when the stamped freshness says the map drifted', () => {
    const root = repo();
    writeMap(root, { anchors_total: 6, anchors_resolved: 4, anchors_broken: 2 });
    const { section, attention } = collectSiteMap(root);
    expect(section.score).toBe(67);
    expect(attention).toHaveLength(1);
    expect(attention[0]!.severity).toBe('warn');
    expect(attention[0]!.message).toContain('2 of 6 cited anchors no longer resolve');
  });

  it('escalates to critical when five or more anchors are broken, and a zero-anchor map scores clean', () => {
    const root = repo();
    writeMap(root, { anchors_total: 9, anchors_resolved: 4, anchors_broken: 5 });
    expect(collectSiteMap(root).attention[0]!.severity).toBe('critical');

    const empty = repo();
    writeMap(empty, { anchors_total: 0, anchors_resolved: 0, anchors_broken: 0 });
    expect(collectSiteMap(empty).section.score).toBe(100);
  });
});
