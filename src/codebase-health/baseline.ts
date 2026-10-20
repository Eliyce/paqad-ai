import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VERSION } from '@/index.js';
import { PATHS } from '@/core/constants/paths.js';
import type { HealthBaseline, HealthFinding } from '@/core/types/codebase-health.js';

import { writeJsonFile } from './shared.js';

export function baselinePath(projectRoot: string): string {
  return join(projectRoot, PATHS.HEALTH_BASELINE);
}

export function readBaseline(projectRoot: string): HealthBaseline | null {
  const target = baselinePath(projectRoot);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as HealthBaseline;
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
): Promise<HealthBaseline> {
  const baseline: HealthBaseline = {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: VERSION,
    created_at: now.toISOString(),
    finding_ids: [...findingIds].sort(),
  };
  await writeJsonFile(baselinePath(projectRoot), baseline);
  return baseline;
}

export function applyBaselineStatus<T extends HealthFinding>(
  findings: T[],
  baseline: HealthBaseline | null,
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
