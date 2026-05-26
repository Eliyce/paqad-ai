import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

import { ageInDays, bandForScore, scoreFreshness } from '../scoring/index.js';
import type { SectionData } from '../types.js';
import { fileMtime } from './fs-helpers.js';

interface ProfileSubset {
  intelligence?: {
    rag_enabled?: unknown;
    embedding_provider?: unknown;
    embedding_model?: unknown;
  };
}

const HELPER = {
  what: 'Hybrid RAG combines vector embeddings with keyword/symbol/path scoring to retrieve relevant context. Configured via project-profile.yaml and indexed under .paqad/vectors/.',
  goodLooksLike:
    'rag_enabled: true, an embedding_provider set, and a vector index refreshed in the last 30 days.',
} as const;

export function collectRagStatus(projectRoot: string, now: number = Date.now()): SectionData {
  const profilePath = join(projectRoot, PATHS.PROJECT_PROFILE);
  let profile: ProfileSubset | null = null;
  if (existsSync(profilePath)) {
    try {
      profile = (YAML.parse(readFileSync(profilePath, 'utf8')) ?? {}) as ProfileSubset;
    } catch {
      profile = null;
    }
  }

  if (profile === null) {
    return {
      id: 'rag-status',
      title: 'RAG status',
      band: 'unknown',
      score: null,
      summary: 'No project-profile.yaml — RAG status unknown.',
      metrics: [],
      helper: HELPER,
    };
  }

  const enabled = profile.intelligence?.rag_enabled === true;
  if (!enabled) {
    return {
      id: 'rag-status',
      title: 'RAG status',
      band: 'unknown',
      score: null,
      summary: 'RAG disabled in project-profile.yaml.',
      metrics: [{ label: 'rag', value: 'disabled' }],
      helper: HELPER,
    };
  }

  const provider =
    typeof profile.intelligence?.embedding_provider === 'string'
      ? (profile.intelligence.embedding_provider as string)
      : null;
  const vectorMeta = join(projectRoot, PATHS.VECTOR_META);
  const vectorIndex = join(projectRoot, PATHS.VECTOR_INDEX);
  const vectorPresent = existsSync(vectorMeta) || existsSync(vectorIndex);
  const indexMtime = fileMtime(vectorMeta) ?? fileMtime(vectorIndex);
  const indexFreshness = scoreFreshness(indexMtime, { now });

  // Composite: provider configured (30) + index present (30) + freshness (40).
  let score = 0;
  if (provider !== null) score += 30;
  if (vectorPresent) score += 30;
  score += Math.round((indexFreshness * 40) / 100);

  const age = ageInDays(indexMtime, now);
  const summary = !vectorPresent
    ? `Enabled but no index — run \`paqad-ai rag rebuild\`.`
    : provider === null
      ? 'Enabled but no embedding provider configured.'
      : `${provider} · index ${age !== null ? `${age}d old` : 'present'}`;

  return {
    id: 'rag-status',
    title: 'RAG status',
    band: bandForScore(score),
    score,
    summary,
    metrics: [
      { label: 'provider', value: provider ?? '—' },
      { label: 'index', value: vectorPresent ? 'present' : 'missing' },
      { label: 'age', value: age !== null ? `${age}d` : '—' },
    ],
    helper: HELPER,
    details: {
      enabled,
      provider,
      vectorMtimeMs: indexMtime,
    },
  };
}
