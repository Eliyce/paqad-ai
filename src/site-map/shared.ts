// Stable finding identity, timestamps, and ordering for the site-map engine. Mirrors the
// codebase-health `shared.ts` discipline (and, transitively, the pentest scheme): a
// finding's identity is a content-addressed hash of its meaning, so the SAME defect gets
// the SAME id across runs — the precondition retest matching depends on.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SiteMapFinding } from '@/core/types/site-map-run.js';

/** Local, dependency-free timestamp for run ids and report filenames (local time). */
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

/**
 * Content-addressed fingerprint over a finding's identity fields, so the same problem gets
 * the same id across runs. Excludes the volatile `id`, `status`, and `baseline_status`.
 */
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
  // SHA-256 (not for security — a stable content-addressed dedup key; only already-safe
  // map metadata reaches here).
  return createHash('sha256').update(payload).digest('hex').slice(0, 8).toUpperCase();
}

/**
 * Assign stable `SM-<sha256[:8]>` ids, suffixing `-NN` on a fingerprint collision (mirrors
 * the codebase-health / pentest scheme). `SM-` is the id prefix; the finding's `category`
 * (e.g. `SM-ADD`) is a separate field.
 */
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

/** Order findings most-severe first, deterministic ties broken by id. */
export function sortFindings<T extends SiteMapFinding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.id.localeCompare(b.id);
  });
}
