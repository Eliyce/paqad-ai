import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { HealthFinding } from '@/core/types/codebase-health.js';

/** Local, dependency-free timestamp for run ids and report filenames. */
export function toHealthTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function toHealthReportId(prefix: 'HEALTH' | 'RETEST', date: Date): string {
  return `${prefix}-${toHealthTimestamp(date)}`;
}

export async function writeJsonFile(target: string, data: unknown): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Content-addressed fingerprint over a finding's identity fields, so the same
 * problem gets the same id across runs (the retest precondition). Excludes the
 * volatile `id`, `status`, and `baseline_status` fields.
 */
export function findingFingerprint(finding: Omit<HealthFinding, 'id'>): string {
  const payload = JSON.stringify({
    title: finding.title,
    category: finding.category,
    tier: finding.tier,
    severity: finding.severity,
    affected_files: [...finding.affected_files].sort(),
    affected_packages: [...finding.affected_packages].sort(),
    evidence: finding.evidence,
    suggestion: finding.suggestion,
  });
  return createHash('sha1').update(payload).digest('hex').slice(0, 8).toUpperCase();
}

/**
 * Assign stable `HL-<sha1[:8]>` ids, suffixing `-NN` on a fingerprint collision
 * (mirrors the pentest `assignFindingIds` scheme).
 */
export function assignHealthFindingIds<T extends Omit<HealthFinding, 'id'>>(
  findings: T[],
): Array<T & { id: string }> {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const fingerprint = findingFingerprint(finding);
    const occurrence = (seen.get(fingerprint) ?? 0) + 1;
    seen.set(fingerprint, occurrence);
    const id =
      occurrence === 1
        ? `HL-${fingerprint}`
        : `HL-${fingerprint}-${String(occurrence).padStart(2, '0')}`;
    return { ...finding, id };
  });
}

const SEVERITY_RANK: Record<HealthFinding['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Order findings most-severe first, deterministic ties broken by id. */
export function sortFindings<T extends HealthFinding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.id.localeCompare(b.id);
  });
}
