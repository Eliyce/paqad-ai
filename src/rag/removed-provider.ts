import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { layeredConfigMap } from '@/core/framework-config.js';

export const REMOVED_EMBEDDING_PROVIDERS = ['voyageai'] as const;
export type RemovedEmbeddingProviderName = (typeof REMOVED_EMBEDDING_PROVIDERS)[number];

export const REMOVED_EMBEDDING_PROVIDER_MESSAGE =
  'The Voyage embedding provider was removed from paqad-ai. Choose local or openai instead: ' +
  'set rag_embedding_provider (or PAQAD_RAG_EMBEDDING_PROVIDER) to local or openai, ' +
  'or run `paqad-ai rag init --provider local`.';

export class RemovedEmbeddingProviderError extends Error {
  constructor(readonly provider: RemovedEmbeddingProviderName) {
    super(REMOVED_EMBEDDING_PROVIDER_MESSAGE);
    this.name = 'RemovedEmbeddingProviderError';
  }
}

export function isRemovedEmbeddingProviderError(
  error: unknown,
): error is RemovedEmbeddingProviderError {
  return error instanceof RemovedEmbeddingProviderError;
}

export function findRemovedEmbeddingProvider(
  value: unknown,
): RemovedEmbeddingProviderName | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return REMOVED_EMBEDDING_PROVIDERS.find((name) => name === normalized);
}

function profileEmbeddingProvider(projectRoot: string): unknown {
  const path = join(projectRoot, PATHS.PROJECT_PROFILE);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = YAML.parse(readFileSync(path, 'utf8')) as {
      intelligence?: { embedding_provider?: unknown };
    } | null;
    return parsed?.intelligence?.embedding_provider;
  } catch {
    return undefined;
  }
}

export function resolveRemovedEmbeddingProvider(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): RemovedEmbeddingProviderName | undefined {
  const configured = layeredConfigMap(projectRoot, env).get('rag_embedding_provider')?.trim();
  return findRemovedEmbeddingProvider(
    configured ? configured : profileEmbeddingProvider(projectRoot),
  );
}

export function assertEmbeddingProviderAvailable(
  projectRoot: string,
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const removed =
    explicit !== undefined && explicit.trim() !== ''
      ? findRemovedEmbeddingProvider(explicit)
      : resolveRemovedEmbeddingProvider(projectRoot, env);
  if (removed) {
    throw new RemovedEmbeddingProviderError(removed);
  }
}
