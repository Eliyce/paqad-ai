import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate.js';
import { recordSiteMapRun } from '@/site-map/ledger.js';
import {
  SITE_MAP_BASELINE_STATUSES,
  SITE_MAP_CATEGORIES,
  SITE_MAP_FINDING_STATUSES,
  SITE_MAP_SEVERITIES,
  SITE_MAP_TIERS,
  SITE_MAP_WORKFLOWS,
} from '@/core/types/site-map-run.js';

describe('site-map run vocabulary', () => {
  it('exposes the closed sets the engine keys on', () => {
    expect(SITE_MAP_WORKFLOWS).toEqual(['site-map', 'site-map-retest']);
    expect(SITE_MAP_SEVERITIES).toEqual(['high', 'medium', 'low']);
    expect(SITE_MAP_CATEGORIES).toContain('SM-GUARD-DRIFT');
    expect(SITE_MAP_CATEGORIES).toContain('SM-ORPHAN');
    expect(SITE_MAP_TIERS).toEqual(['deterministic', 'ai-judged']);
    expect(SITE_MAP_BASELINE_STATUSES).toContain('new-since-baseline');
    expect(SITE_MAP_FINDING_STATUSES).toContain('open');
  });
});

describe('site-map run in the SIEM export', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-siem-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('folds a recorded site-map run into the audit stream with a readable detail', () => {
    recordSiteMapRun(
      root,
      {
        report_id: 'SITEMAP-2026',
        workflow: 'site-map',
        surface_count: 17,
        journey_count: 3,
        finding_count: 2,
        blocked_count: 0,
        new_since_baseline: 2,
        pre_existing: 0,
      },
      { sessionId: 's-1', now: () => new Date(2026, 0, 1) },
    );
    const events = aggregateSiemEvents(root);
    const siteMap = events.find((event) => event.detail.includes('site-map run'));
    expect(siteMap).toBeDefined();
    expect(siteMap!.detail).toContain('SITEMAP-2026');
    expect(siteMap!.detail).toContain('17 surface(s)');
    expect(siteMap!.detail).toContain('2 finding(s)');
    expect(siteMap!.verdict).toBe('findings');
  });
});
