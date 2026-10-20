import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VERSION } from '@/index.js';
import { PATHS } from '@/core/constants/paths.js';
import type { SiteMapBaseline, SiteMapFinding } from '@/core/types/site-map-run.js';

import { writeJsonFile } from './shared.js';

export function baselinePath(projectRoot: string): string {
  return join(projectRoot, PATHS.SITE_MAP_BASELINE);
}

export function readBaseline(projectRoot: string): SiteMapBaseline | null {
  const target = baselinePath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as SiteMapBaseline;
    if (!Array.isArray(parsed.finding_ids)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeBaseline(
  projectRoot: string,
  findingIds: string[],
  now: Date,
): Promise<SiteMapBaseline> {
  const baseline: SiteMapBaseline = {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    created_at: now.toISOString(),
    finding_ids: [...findingIds].sort(),
  };
  await writeJsonFile(baselinePath(projectRoot), baseline);
  return baseline;
}

export function applyBaselineStatus<T extends SiteMapFinding>(
  findings: T[],
  baseline: SiteMapBaseline | null,
): T[] {
  if (baseline === null) {
    return findings.map((finding) => ({ ...finding, baseline_status: 'unknown' as const }));
  }
  const known = new Set(baseline.finding_ids);
  return findings.map((finding) => ({
    ...finding,
    baseline_status: known.has(finding.id)
      ? ('pre-existing' as const)
      : ('new-since-baseline' as const),
  }));
}
