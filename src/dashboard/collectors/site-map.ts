import { isStale } from '@/site-map/freshness.js';
import { readAllJourneys, readCanonicalSiteMap } from '@/site-map/store.js';

import { bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'The stored map at docs/site-map/ is the single source of truth. Each Run on the Site map area checks every cited file:line against the code and stamps the earned trust and freshness back into the map.',
  goodLooksLike:
    'A map whose cited anchors all still resolve against the code, with journeys confirmed through the audited surface.',
} as const;

export interface SiteMapDashboardResult {
  section: SectionData;
  attention: AttentionItem[];
}

function emptySection(summary: string): SiteMapDashboardResult {
  return {
    section: {
      id: 'site-map',
      title: 'Site map',
      band: 'unknown',
      score: null,
      summary,
      metrics: [],
      helper: HELPER,
    },
    attention: [],
  };
}

/**
 * Dashboard section for the site map — read STATICALLY from the stored canonical map
 * (issue #466, ART-3/NFR-4): surfaces, journeys, and the stamped map-vs-code freshness.
 * There are no report dumps to collect; a map that has never been checked against the
 * code reads honestly as not yet checked, never as fresh.
 */
export function collectSiteMap(projectRoot: string): SiteMapDashboardResult {
  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) {
    return emptySection('No site map yet — create one from the Site map area when you need it.');
  }

  const surfaceCount = map.surfaces.length;
  const journeyCount = readAllJourneys(projectRoot).length;
  const freshness = map.app.freshness;

  if (freshness === undefined) {
    return {
      section: {
        id: 'site-map',
        title: 'Site map',
        band: 'unknown',
        score: null,
        summary: `${surfaceCount} surface(s) · ${journeyCount} journey(s) · not yet checked against code`,
        metrics: [
          { label: 'surfaces', value: String(surfaceCount) },
          { label: 'journeys', value: String(journeyCount) },
          { label: 'anchors checked', value: '—' },
        ],
        helper: HELPER,
        details: { surfaces: surfaceCount, journeys: journeyCount, freshness: null },
      },
      attention: [],
    };
  }

  const score =
    freshness.anchors_total === 0
      ? 100
      : Math.round((100 * freshness.anchors_resolved) / freshness.anchors_total);
  const stale = isStale(freshness);

  const attention: AttentionItem[] = stale
    ? [
        {
          sectionId: 'site-map',
          message: `Site map has drifted from code: ${freshness.anchors_broken} of ${freshness.anchors_total} cited anchors no longer resolve`,
          severity: freshness.anchors_broken >= 5 ? 'critical' : 'warn',
        },
      ]
    : [];

  return {
    section: {
      id: 'site-map',
      title: 'Site map',
      band: bandForScore(score),
      score,
      summary: `${surfaceCount} surface(s) · ${journeyCount} journey(s) · ${freshness.anchors_resolved} of ${freshness.anchors_total} anchors resolve`,
      metrics: [
        { label: 'surfaces', value: String(surfaceCount) },
        { label: 'journeys', value: String(journeyCount) },
        { label: 'anchors resolving', value: `${freshness.anchors_resolved}/${freshness.anchors_total}` },
        { label: 'broken anchors', value: String(freshness.anchors_broken) },
      ],
      helper: HELPER,
      details: {
        surfaces: surfaceCount,
        journeys: journeyCount,
        freshness,
        stale,
      },
    },
    attention,
  };
}
