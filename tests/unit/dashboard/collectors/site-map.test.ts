import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { SiteMapReportIndex } from '@/core/types/site-map-run.js';
import { collectSiteMap } from '@/dashboard/collectors/site-map.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'sm-dash-'));
}

function writeSidecar(root: string, name: string, report: Partial<SiteMapReportIndex>): void {
  const dir = join(root, PATHS.SITE_MAP_REPORT_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(report));
}

const NOW = Date.parse('2026-07-14T00:00:00.000Z');

describe('collectSiteMap', () => {
  it('is an unknown, empty section when there are no runs', () => {
    const { section, attention } = collectSiteMap(repo(), NOW);
    expect(section.id).toBe('site-map');
    expect(section.band).toBe('unknown');
    expect(section.summary).toContain('No site-map runs yet');
    expect(attention).toEqual([]);
  });

  it('handles an unreadable latest sidecar', () => {
    const root = repo();
    const dir = join(root, PATHS.SITE_MAP_REPORT_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-07-13-00-00-00.json'), 'not json');
    const { section } = collectSiteMap(root, NOW);
    expect(section.summary).toContain('unreadable');
  });

  it('summarises surfaces/journeys and raises attention for open findings', () => {
    const root = repo();
    writeSidecar(root, '2026-07-13-00-00-00.json', {
      report_id: 'SITEMAP-2026-07-13-00-00-00',
      generated_at: '2026-07-13T00:00:00.000Z',
      surface_count: 12,
      journey_count: 3,
      findings: [{ id: 'SM-1', status: 'open' } as never, { id: 'SM-2', status: 'open' } as never],
      blocked_checks: [{ check: 'reachability', reason: 'x', install_hint: 'y' }],
    });
    const { section, attention } = collectSiteMap(root, NOW);
    expect(section.metrics.find((m) => m.label === 'surfaces')?.value).toBe('12');
    expect(section.metrics.find((m) => m.label === 'journeys')?.value).toBe('3');
    expect(section.metrics.find((m) => m.label === 'open findings')?.value).toBe('2');
    expect(attention).toHaveLength(1);
    expect(attention[0]!.severity).toBe('warn');
  });

  it('degrades to an em-dash age when generated_at is unparseable', () => {
    const root = repo();
    writeSidecar(root, '2026-07-13-00-00-00.json', {
      report_id: 'SITEMAP-x',
      generated_at: 'not-a-date',
      surface_count: 0,
      journey_count: 0,
      findings: [],
      blocked_checks: [],
    });
    const { section } = collectSiteMap(root, NOW);
    expect(section.metrics.find((m) => m.label === 'latest')?.value).toBe('—');
  });

  it('marks critical attention when 5+ findings are open, and excludes retest sidecars', () => {
    const root = repo();
    writeSidecar(root, '2026-07-13-00-00-00-retest-2026-07-14-00-00-00.json', {
      report_id: 'RETEST',
      generated_at: '2026-07-14T00:00:00.000Z',
      surface_count: 1,
      journey_count: 0,
      findings: [],
      blocked_checks: [],
    });
    writeSidecar(root, '2026-07-12-00-00-00.json', {
      report_id: 'SITEMAP-2026-07-12-00-00-00',
      generated_at: '2026-07-12T00:00:00.000Z',
      surface_count: 8,
      journey_count: 1,
      findings: Array.from({ length: 5 }, (_, i) => ({ id: `SM-${i}`, status: 'open' }) as never),
      blocked_checks: [],
    });
    const { section, attention } = collectSiteMap(root, NOW);
    // The retest sidecar is excluded, so the web/page surface count comes from the base run.
    expect(section.metrics.find((m) => m.label === 'surfaces')?.value).toBe('8');
    expect(attention[0]!.severity).toBe('critical');
  });
});
