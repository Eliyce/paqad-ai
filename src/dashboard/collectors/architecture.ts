import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { ageInDays, bandForScore, scoreFreshness } from '../scoring/index.js';
import type { SectionData } from '../types.js';

const HELPER = {
  what: 'The architecture/graph section is powered by .paqad/context/chunk-index.json — the AST-aware chunk index `paqad-ai graph` renders into a WebGL map.',
  goodLooksLike: 'chunk-index.json present, non-empty, and refreshed in the last 30 days.',
} as const;

export function collectArchitecture(projectRoot: string, now: number = Date.now()): SectionData {
  const indexPath = join(projectRoot, PATHS.CHUNK_INDEX);
  if (!existsSync(indexPath)) {
    return {
      id: 'architecture',
      title: 'Architecture',
      band: 'unknown',
      score: null,
      summary: 'No chunk index — run `paqad-ai graph` to build it.',
      metrics: [],
      helper: HELPER,
    };
  }

  let mtimeMs: number | null;
  let sizeBytes: number;
  try {
    const st = statSync(indexPath);
    mtimeMs = st.mtimeMs;
    sizeBytes = st.size;
  } catch {
    return {
      id: 'architecture',
      title: 'Architecture',
      band: 'unknown',
      score: null,
      summary: 'Chunk index disappeared between checks.',
      metrics: [],
      helper: HELPER,
    };
  }

  if (sizeBytes < 50) {
    return {
      id: 'architecture',
      title: 'Architecture',
      band: 'red',
      score: 0,
      summary: 'Chunk index is empty — re-run `paqad-ai graph`.',
      metrics: [{ label: 'size', value: '0' }],
      helper: HELPER,
    };
  }

  const freshness = scoreFreshness(mtimeMs, { now });
  const age = ageInDays(mtimeMs, now);
  const score = Math.round(50 + (freshness / 100) * 50);

  return {
    id: 'architecture',
    title: 'Architecture',
    band: bandForScore(score),
    score,
    summary: `Chunk index ready · ${age !== null ? `${age}d old` : 'recent'} · ${Math.round(sizeBytes / 1024)} KB`,
    metrics: [
      { label: 'size', value: `${Math.round(sizeBytes / 1024)} KB` },
      { label: 'age', value: age !== null ? `${age}d` : '—' },
    ],
    helper: HELPER,
    details: {
      indexPath: PATHS.CHUNK_INDEX,
      mtimeMs,
      sizeBytes,
    },
  };
}
