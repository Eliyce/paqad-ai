import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readHealthSidecar } from '@/codebase-health/store.js';

import { ageInDays, bandForScore, scoreFreshness } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: 'Each `paqad-ai health run` writes a report + sidecar under docs/health/ with findings, blocked checks, and the baseline ratchet.',
  goodLooksLike:
    'A recent run with no open findings, or a retest closing prior findings; blocked checks resolved by installing the named tool.',
} as const;

export interface CodebaseHealthResult {
  section: SectionData;
  attention: AttentionItem[];
}

function listSidecars(projectRoot: string): string[] {
  const dir = join(projectRoot, PATHS.HEALTH_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && !name.includes('-retest-'))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function emptySection(summary: string): CodebaseHealthResult {
  return {
    section: {
      id: 'codebase-health',
      title: 'Codebase health',
      band: 'unknown',
      score: null,
      summary,
      metrics: [],
      helper: HELPER,
    },
    attention: [],
  };
}

/** Dashboard section for the codebase-health workflow — latest run, open findings, age. */
export function collectCodebaseHealth(
  projectRoot: string,
  now: number = Date.now(),
): CodebaseHealthResult {
  const sidecars = listSidecars(projectRoot);
  if (sidecars.length === 0) {
    return emptySection('No health runs yet — run `paqad-ai health run` when you need one.');
  }

  const latestPath = sidecars.at(-1)!;
  const report = readHealthSidecar(latestPath);
  if (!report) {
    return emptySection('Health reports present but the latest sidecar is unreadable.');
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

  const summary = `${sidecars.length} run(s) · ${findingCount} finding(s) · ${report.blocked_checks.length} blocked${
    age !== null ? ` · ${age}d ago` : ''
  }`;

  const attention: AttentionItem[] =
    openFindings > 0
      ? [
          {
            sectionId: 'codebase-health',
            message: `${openFindings} open codebase-health finding(s) in ${report.report_id}`,
            severity: openFindings >= 5 ? 'critical' : 'warn',
          },
        ]
      : [];

  return {
    section: {
      id: 'codebase-health',
      title: 'Codebase health',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'runs', value: String(sidecars.length) },
        { label: 'open findings', value: String(openFindings) },
        { label: 'blocked', value: String(report.blocked_checks.length) },
        { label: 'latest', value: age !== null ? `${age}d` : '—' },
      ],
      helper: HELPER,
      details: {
        latestReport: report.report_id,
        findings: findingCount,
        blockedChecks: report.blocked_checks,
      },
    },
    attention,
  };
}
