import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadOptionalPackage } from '@/core/optional-package.js';
import { getDefaultEmbeddingModel } from '@/core/project-intelligence.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { EmbeddingProviderName, IntelligenceConfig } from '@/core/types/project-profile.js';

import { assertEmbeddingProviderAvailable } from './removed-provider.js';
import { getProjectSecret } from './secrets.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderErrorCode,
  LocalEmbeddingExtractor,
  LocalEmbeddingProgress,
  OpenAiEmbeddingClient,
  ProviderProgressUpdate,
  TransformersRuntimeEnv,
} from './types.js';
import { EmbeddingProviderError } from './types.js';

const REMOTE_RETRY_DELAYS_MS = [250, 500, 1000] as const;

export function localModelsRoot(): string {
  return join(homedir(), '.paqad', 'models');
}

export function localModelDir(model: string): string {
  return join(localModelsRoot(), model);
}

function providerError(
  provider: EmbeddingProviderName,
  code: EmbeddingProviderErrorCode,
  message: string,
  cause?: unknown,
): EmbeddingProviderError {
  return new EmbeddingProviderError(provider, code, message, cause);
}

function classifyRemoteError(provider: 'openai', error: unknown): EmbeddingProviderError {
  if (error instanceof EmbeddingProviderError) {
    return error;
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: number }).status)
      : typeof error === 'object' &&
          error !== null &&
          'response' in error &&
          typeof (error as { response?: { status?: number } }).response?.status === 'number'
        ? Number((error as { response?: { status?: number } }).response?.status)
        : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return providerError(provider, 'invalid_api_key', 'Invalid OPENAI_API_KEY', error);
  }
  if (status === 429 || /rate.?limit/i.test(message)) {
    return providerError(
      provider,
      'rate_limited',
      `${provider} embedding rate limit reached`,
      error,
    );
  }
  return providerError(provider, 'provider_error', message, error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRemoteRetry<T>(
  provider: 'openai',
  operation: () => Promise<T>,
  onProgress?: (update: ProviderProgressUpdate) => void,
): Promise<T> {
  for (let attempt = 0; attempt <= REMOTE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifyRemoteError(provider, error);
      if (classified.code !== 'rate_limited' || attempt === REMOTE_RETRY_DELAYS_MS.length) {
        throw classified;
      }
      const delayMs = REMOTE_RETRY_DELAYS_MS[attempt];
      onProgress?.({
        phase: 'build',
        message: `${classified.message}; retrying in ${delayMs}ms`,
      });
      await sleep(delayMs);
    }
  }

  throw providerError(provider, 'provider_error', `Unexpected ${provider} retry failure`);
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local' as const;
  readonly model: string;
  private extractorPromise?: Promise<LocalEmbeddingExtractor>;

  constructor(
    intelligence: IntelligenceConfig,
    private readonly onProgress?: (update: ProviderProgressUpdate) => void,
  ) {
    this.model = intelligence.embedding_model ?? getDefaultEmbeddingModel('local');
  }

  async validate(): Promise<void> {
    await this.getExtractor();
  }

  async embed(input: string | string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const batch = Array.isArray(input) ? input : [input];
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const rawValues =
      typeof output === 'object' &&
      output !== null &&
      'tolist' in output &&
      typeof output.tolist === 'function'
        ? (output.tolist() as number[] | number[][])
        : (output as number[] | number[][]);
    return Array.isArray(rawValues[0]) ? (rawValues as number[][]) : [rawValues as number[]];
  }

  private async getExtractor(): Promise<LocalEmbeddingExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.loadExtractor();
    }
    return this.extractorPromise;
  }

  private async loadExtractor(): Promise<LocalEmbeddingExtractor> {
    const modelPath = localModelDir(this.model);
    const cached = existsSync(modelPath);
    this.onProgress?.({
      phase: 'load',
      message: cached
        ? `Loading cached local embedding model ${this.model}`
        : `Preparing local embedding model ${this.model}. This shared download only happens once.`,
    });
    try {
      const { pipeline, env } = await loadOptionalPackage<{
        pipeline: (
          task: 'feature-extraction',
          model: string,
          options: {
            dtype?: 'q8';
            progress_callback?: (progress: LocalEmbeddingProgress) => void;
          },
        ) => Promise<LocalEmbeddingExtractor>;
        env: TransformersRuntimeEnv;
      }>('@huggingface/transformers');
      const modelsDir = toPosixPath(localModelsRoot());
      env.cacheDir = modelsDir;
      env.localModelPath = modelsDir;
      env.allowLocalModels = true;
      env.allowRemoteModels = !cached;
      return pipeline('feature-extraction', this.model, {
        dtype: 'q8',
        progress_callback: (progress: LocalEmbeddingProgress) => {
          const loaded = progress.loaded ?? 0;
          const total = progress.total ?? 0;
          const percent = total > 0 ? Math.round((loaded / total) * 100) : undefined;
          this.onProgress?.({
            phase: 'download',
            message:
              progress.status ??
              `Downloading local model ${this.model}. This shared download only happens once.`,
            loaded,
            total,
            percent,
          });
        },
      });
    } catch (error) {
      await rm(modelPath, { recursive: true, force: true }).catch(() => undefined);
      throw providerError(
        'local',
        'download_failed',
        `Failed to load local model ${this.model}`,
        error,
      );
    }
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private clientPromise?: Promise<OpenAiEmbeddingClient>;

  constructor(
    private readonly projectRoot: string,
    intelligence: IntelligenceConfig,
    private readonly onProgress?: (update: ProviderProgressUpdate) => void,
  ) {
    this.model = intelligence.embedding_model ?? getDefaultEmbeddingModel('openai');
  }

  async validate(): Promise<void> {
    await this.embed('validation');
  }

  async embed(input: string | string[]): Promise<number[][]> {
    const client = await this.getClient();
    const response = await withRemoteRetry(
      'openai',
      () =>
        client.embeddings.create({
          model: this.model,
          input,
        }),
      this.onProgress,
    );
    return response.data.map((entry: { embedding: number[] }) => entry.embedding);
  }

  private async getClient(): Promise<OpenAiEmbeddingClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    return this.clientPromise;
  }

  private async createClient(): Promise<OpenAiEmbeddingClient> {
    const apiKey = getProjectSecret(this.projectRoot, 'OPENAI_API_KEY');
    if (!apiKey) {
      throw providerError('openai', 'missing_api_key', 'Missing OPENAI_API_KEY');
    }
    const { OpenAI } = await loadOptionalPackage<{
      OpenAI: new (options: { apiKey: string }) => OpenAiEmbeddingClient;
    }>('openai');
    return new OpenAI({ apiKey });
  }
}

export async function createEmbeddingProvider(
  projectRoot: string,
  intelligence: IntelligenceConfig,
  onProgress?: (update: ProviderProgressUpdate) => void,
): Promise<EmbeddingProvider> {
  assertEmbeddingProviderAvailable(projectRoot, intelligence.embedding_provider);
  switch (intelligence.embedding_provider) {
    case 'openai':
      return new OpenAiEmbeddingProvider(projectRoot, intelligence, onProgress);
    case 'local':
    default:
      return new LocalEmbeddingProvider(intelligence, onProgress);
  }
}
