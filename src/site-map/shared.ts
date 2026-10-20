import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SiteMapFinding } from '@/core/types/site-map-run.js';

export function toSiteMapTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function toSiteMapReportId(prefix: 'SITEMAP' | 'RETEST', date: Date): string {
  return `${prefix}-${toSiteMapTimestamp(date)}`;
}

export async function writeJsonFile(target: string, data: unknown): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`);
}

export function findingFingerprint(finding: Omit<SiteMapFinding, 'id'>): string {
  const payload = JSON.stringify({
    title: finding.title,
    category: finding.category,
    tier: finding.tier,
    severity: finding.severity,
    affected_surfaces: [...finding.affected_surfaces].sort(),
    affected_files: [...finding.affected_files].sort(),
    evidence: finding.evidence,
    resolution: finding.resolution,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 8).toUpperCase();
}

export function assignSiteMapFindingIds<T extends Omit<SiteMapFinding, 'id'>>(
  findings: T[],
): Array<T & { id: string }> {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const fingerprint = findingFingerprint(finding);
    const occurrence = (seen.get(fingerprint) ?? 0) + 1;
    seen.set(fingerprint, occurrence);
    const id =
      occurrence === 1
        ? `SM-${fingerprint}`
        : `SM-${fingerprint}-${String(occurrence).padStart(2, '0')}`;
    return { ...finding, id };
  });
}

const SEVERITY_RANK: Record<SiteMapFinding['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sortFindings<T extends SiteMapFinding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.id.localeCompare(b.id);
  });
}
