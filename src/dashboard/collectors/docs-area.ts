import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  ageInDays,
  bandForScore,
  scoreFreshness,
  scoreFreshnessAverage,
} from '../scoring/index.js';
import type { DashboardSectionId, SectionData } from '../types.js';
import { scanDirectory, type ScannedEntry } from './fs-helpers.js';

export interface DocsAreaSpec {
  id: DashboardSectionId;
  title: string;
  relPath: string;
  expectedMin?: number;
  fileFilter?: (name: string) => boolean;
  helper: { what: string; goodLooksLike: string };
  missingCommand?: string;
}

const DEFAULT_FILTER = (n: string): boolean =>
  n.endsWith('.md') || n.endsWith('.yaml') || n.endsWith('.yml') || n.endsWith('.json');

export function collectDocsArea(
  projectRoot: string,
  spec: DocsAreaSpec,
  now: number = Date.now(),
): SectionData {
  const absPath = join(projectRoot, spec.relPath);
  const missingCommand = spec.missingCommand ?? '`create documentation`';

  if (!existsSync(absPath)) {
    return {
      id: spec.id,
      title: spec.title,
      band: 'unknown',
      score: null,
      summary: `Not configured — run ${missingCommand}.`,
      metrics: [],
      helper: spec.helper,
    };
  }

  const fileFilter = spec.fileFilter ?? DEFAULT_FILTER;
  const entries: ScannedEntry[] = scanDirectory(absPath, { fileFilter });
  const expectedMin = Math.max(1, spec.expectedMin ?? 1);

  if (entries.length === 0) {
    return {
      id: spec.id,
      title: spec.title,
      band: 'red',
      score: 0,
      summary: `Empty — run ${missingCommand}.`,
      metrics: [{ label: 'files', value: '0' }],
      helper: spec.helper,
    };
  }

  const presenceRatio = Math.min(1, entries.length / expectedMin);
  const freshness = scoreFreshnessAverage(
    entries.map((e) => e.mtimeMs),
    { now },
  );
  const score = Math.round(presenceRatio * 60 + (freshness / 100) * 40);
  const newestMs = Math.max(...entries.map((e) => e.mtimeMs));
  const newestAge = ageInDays(newestMs, now);
  const staleCount = entries.filter((e) => scoreFreshness(e.mtimeMs, { now }) < 100).length;

  return {
    id: spec.id,
    title: spec.title,
    band: bandForScore(score),
    score,
    summary:
      staleCount === 0
        ? `${entries.length} file(s) · all fresh`
        : `${entries.length} file(s) · ${staleCount} stale`,
    metrics: [
      { label: 'files', value: String(entries.length) },
      { label: 'stale', value: String(staleCount) },
      { label: 'newest', value: newestAge !== null ? `${newestAge}d` : '—' },
    ],
    helper: spec.helper,
    details: {
      entries: entries.slice(0, 50).map((e) => ({ path: e.relPath, mtimeMs: e.mtimeMs })),
    },
  };
}
