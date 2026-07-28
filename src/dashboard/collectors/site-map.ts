import { findLatestSiteMapSidecar, readSiteMapSidecar } from '@/site-map/store.js';

import { ageInDays, bandForScore, scoreFreshness } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'Each Run (the button on the Site map area) writes a report + sidecar under docs/site-map/ with the mapped surfaces, journeys, findings, and blocked checks.',
  goodLooksLike:
    'A recent run whose map matches the code (no open findings), every extractor available, and journeys confirmed through the audited surface.',
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

/** Dashboard section for the site-map workflow — latest run, surfaces, journeys, open findings. */
export function collectSiteMap(
  projectRoot: string,
  now: number = Date.now(),
): SiteMapDashboardResult {
  const latestPath = findLatestSiteMapSidecar(projectRoot);
  if (!latestPath) {
    return emptySection('No site-map runs yet — hit Run on the Site map area when you need one.');
  }

  const report = readSiteMapSidecar(latestPath);
  if (!report) {
    return emptySection('Site-map reports present but the latest sidecar is unreadable.');
  }

  const updatedMs = Date.parse(report.generated_at);
  const findingCount = report.findings.length;
  const openFindings = report.findings.filter((finding) => finding.status === 'open').length;
  const freshness = scoreFreshness(Number.isFinite(updatedMs) ? updatedMs : null, { now });
  const findingsScore = findingCount === 0 ? 100 : Math.max(0, 100 - findingCount * 10);
  let score = Math.round(freshness * 0.5 + findingsScore * 0.5);
  if (report.blocked_checks.length > 0) {
    score = Math.min(score, 80);
  }
  const age = ageInDays(Number.isFinite(updatedMs) ? updatedMs : null, now);

  const summary = `${report.surface_count} surface(s) · ${report.journey_count} journey(s) · ${findingCount} finding(s)${
    age !== null ? ` · ${age}d ago` : ''
  }`;

  const attention: AttentionItem[] =
    openFindings > 0
      ? [
          {
            sectionId: 'site-map',
            message: `${openFindings} open site-map finding(s) in ${report.report_id}`,
            severity: openFindings >= 5 ? 'critical' : 'warn',
          },
        ]
      : [];

  return {
    section: {
      id: 'site-map',
      title: 'Site map',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'surfaces', value: String(report.surface_count) },
        { label: 'journeys', value: String(report.journey_count) },
        { label: 'open findings', value: String(openFindings) },
        { label: 'latest', value: age !== null ? `${age}d` : '—' },
      ],
      helper: HELPER,
      details: {
        latestReport: report.report_id,
        surfaces: report.surface_count,
        journeys: report.journey_count,
        findings: findingCount,
        blockedChecks: report.blocked_checks,
      },
    },
    attention,
  };
}
