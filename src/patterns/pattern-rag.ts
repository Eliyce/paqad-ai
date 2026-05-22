import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

import { PATHS } from '@/core/constants/paths.js';
import {
  getDefaultEmbeddingModel,
  normalizeIntelligenceConfig,
} from '@/core/project-intelligence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { createEmbeddingProvider } from '@/rag/providers.js';
import type { EmbeddingProvider, ProviderFactory, StoredVectorItem } from '@/rag/types.js';
import { FileVectorIndex } from '@/rag/vector-index.js';

import { PatternStore } from './pattern-store.js';
import { PatternSuggester, type PatternSemanticScorer } from './pattern-suggester.js';
import type { Pattern, PatternMatch } from './types.js';

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export interface StoredPatternVector extends StoredVectorItem {
  fingerprint: string;
  category: string;
  tags: string[];
  problem_preview: string;
}

function patternText(pattern: Pattern): string {
  return [
    pattern.problem,
    pattern.solution,
    ...pattern.tags,
    ...pattern.files_involved,
    ...pattern.stack_filter.frameworks,
    ...pattern.stack_filter.traits,
  ].join('\n');
}

function fingerprint(pattern: Pattern): string {
  return createHash('sha1').update(patternText(pattern)).digest('hex');
}

function sanitizeNamespaceSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0
    ? normalized
    : createHash('sha1').update(value).digest('hex').slice(0, 12);
}

export function getGlobalPatternVectorPaths(
  provider?: string,
  model?: string,
): {
  index: string;
  meta: string;
} {
  if (!provider || !model) {
    return {
      index: PATHS.GLOBAL_PATTERN_VECTOR_INDEX,
      meta: PATHS.GLOBAL_PATTERN_VECTOR_META,
    };
  }

  const namespace = `${sanitizeNamespaceSegment(provider)}/${sanitizeNamespaceSegment(model)}`;
  return {
    index: `${PATHS.GLOBAL_PATTERN_VECTORS_DIR}/${namespace}/index.json`,
    meta: `${PATHS.GLOBAL_PATTERN_VECTORS_DIR}/${namespace}/meta.json`,
  };
}

export class PatternVectorService {
  constructor(
    private readonly store = new PatternStore(),
    private readonly providerFactory: ProviderFactory = createEmbeddingProvider,
  ) {}

  private getIndex(projectRoot: string): FileVectorIndex<StoredPatternVector> {
    const profile = readProjectProfile(projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    const paths = getGlobalPatternVectorPaths(
      intelligence.embedding_provider,
      intelligence.embedding_provider
        ? (intelligence.embedding_model ??
            getDefaultEmbeddingModel(intelligence.embedding_provider))
        : undefined,
    );

    return new FileVectorIndex<StoredPatternVector>(paths.index, paths.meta);
  }

  async getStatus(projectRoot: string): Promise<{
    present: boolean;
    valid: boolean;
    chunk_count: number;
    reason?: string;
  }> {
    const profile = readProjectProfile(projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    const index = this.getIndex(projectRoot);
    const status = await index.status(homedir());
    const expectedModel = intelligence.embedding_provider
      ? (intelligence.embedding_model ?? getDefaultEmbeddingModel(intelligence.embedding_provider))
      : undefined;
    const valid =
      Boolean(status.meta) &&
      !status.corrupt &&
      (!intelligence.rag_enabled ||
        (status.meta?.provider === intelligence.embedding_provider &&
          status.meta?.model === expectedModel));

    return {
      present: status.present,
      valid,
      chunk_count: status.meta?.chunk_count ?? 0,
      reason:
        status.present && !valid
          ? (status.reason ??
            'pattern vector index metadata does not match the current provider or model')
          : undefined,
    };
  }

  async rebuild(projectRoot: string, onProgress?: (message: string) => void): Promise<void> {
    const profile = readProjectProfile(projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      return;
    }

    const provider = await this.providerFactory(projectRoot, intelligence);
    await provider.validate();
    const patterns = await this.store.list();
    const items = await this.embedPatterns(patterns, provider, onProgress);
    await this.getIndex(projectRoot).replaceAll(homedir(), items, {
      provider: provider.name,
      model: provider.model,
    });
  }

  async refresh(projectRoot: string, onProgress?: (message: string) => void): Promise<void> {
    const profile = readProjectProfile(projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      return;
    }

    const status = await this.getStatus(projectRoot);
    if (!status.present || !status.valid) {
      await this.rebuild(projectRoot, onProgress);
      return;
    }

    const provider = await this.providerFactory(projectRoot, intelligence);
    await provider.validate();
    const index = this.getIndex(projectRoot);
    const current = await index.load(homedir());
    if (!current) {
      await this.rebuild(projectRoot, onProgress);
      return;
    }

    const patterns = await this.store.list();
    const nextById = new Map(
      patterns.map((pattern) => [
        pattern.id,
        {
          pattern,
          fingerprint: fingerprint(pattern),
        },
      ]),
    );

    const changedPatterns = patterns.filter((pattern) => {
      const currentItem = current.items.find((item) => item.id === pattern.id);
      return !currentItem || currentItem.fingerprint !== fingerprint(pattern);
    });
    const removedIds = current.items.map((item) => item.id).filter((id) => !nextById.has(id));

    if (changedPatterns.length === 0 && removedIds.length === 0) {
      return;
    }

    onProgress?.(
      `Refreshing pattern vectors (${changedPatterns.length} changed, ${removedIds.length} removed)`,
    );
    const unchanged = current.items.filter(
      (item) =>
        !removedIds.includes(item.id) && !changedPatterns.some((pattern) => pattern.id === item.id),
    );
    const embedded = await this.embedPatterns(changedPatterns, provider, onProgress);
    await index.replaceAll(homedir(), [...unchanged, ...embedded], {
      provider: provider.name,
      model: provider.model,
    });
  }

  async createSemanticScorer(
    projectRoot: string,
    onProgress?: (message: string) => void,
  ): Promise<PatternSemanticScorer | undefined> {
    const profile = readProjectProfile(projectRoot);
    const intelligence = normalizeIntelligenceConfig(profile?.intelligence);
    if (!intelligence.rag_enabled || !intelligence.embedding_provider) {
      return undefined;
    }

    await this.refresh(projectRoot, onProgress);
    const status = await this.getStatus(projectRoot);
    if (!status.present || !status.valid) {
      return undefined;
    }

    const provider = await this.providerFactory(projectRoot, intelligence);
    const current = await this.getIndex(projectRoot).load(homedir());
    if (!current) {
      return undefined;
    }
    const scoreCache = new Map<string, Map<string, number>>();
    return async (pattern, keywords) => {
      if (keywords.length === 0) {
        return 0;
      }

      const query = keywords.join('\n');
      let scores = scoreCache.get(query);
      if (!scores) {
        const [queryVector] = await provider.embed(query);
        scores = new Map(
          current.items.map((item) => [item.id, cosineSimilarity(queryVector, item.vector)]),
        );
        scoreCache.set(query, scores);
      }

      return scores.get(pattern.id) ?? 0;
    };
  }

  async createSuggester(projectRoot: string, relevanceThreshold = 0.3): Promise<PatternSuggester> {
    const scorer = await this.createSemanticScorer(projectRoot);
    return new PatternSuggester(this.store, relevanceThreshold, scorer);
  }

  private async embedPatterns(
    patterns: Pattern[],
    provider: EmbeddingProvider,
    onProgress?: (message: string) => void,
  ): Promise<StoredPatternVector[]> {
    if (patterns.length === 0) {
      return [];
    }

    onProgress?.(`Embedding ${patterns.length} global patterns with ${provider.model}`);
    const vectors = await provider.embed(patterns.map((pattern) => patternText(pattern)));
    return patterns.map((pattern, index) => ({
      id: pattern.id,
      vector: vectors[index],
      fingerprint: fingerprint(pattern),
      category: pattern.category,
      tags: pattern.tags,
      problem_preview: pattern.problem.slice(0, 100),
    }));
  }
}

export async function suggestPatternsForProject(
  projectRoot: string,
  keywords: string[],
  domain: string,
  frameworks: string[],
  limit = 3,
): Promise<PatternMatch[]> {
  const suggester = await new PatternVectorService().createSuggester(projectRoot);
  return suggester.suggest(keywords, domain, frameworks, limit);
}
