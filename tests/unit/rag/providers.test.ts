import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import {
  createEmbeddingProvider,
  LocalEmbeddingProvider,
  OpenAiEmbeddingProvider,
  VoyageEmbeddingProvider,
} from '@/rag/providers.js';

const transformerEnv: Record<string, unknown> = {};
const transformerPipeline = vi.fn();
const openAiEmbeddingsCreate = vi.fn();
const openAiCtor = vi.fn().mockImplementation(() => ({
  embeddings: {
    create: openAiEmbeddingsCreate,
  },
}));
const voyageEmbed = vi.fn();
const voyageCtor = vi.fn().mockImplementation(() => ({
  embed: voyageEmbed,
}));

vi.mock('@xenova/transformers', () => ({
  env: transformerEnv,
  pipeline: transformerPipeline,
}));

vi.mock('openai', () => ({
  OpenAI: openAiCtor,
}));

vi.mock('voyageai', () => ({
  VoyageAIClient: voyageCtor,
}));

function makeIntelligence(overrides: Partial<IntelligenceConfig> = {}): IntelligenceConfig {
  return {
    rag_enabled: true,
    embedding_provider: 'local',
    embedding_model: 'fake-model',
    rag_similarity_threshold: 0.75,
    rag_top_n: 20,
    ...overrides,
  };
}

describe('RAG embedding providers', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-providers-'));
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    for (const key of Object.keys(transformerEnv)) {
      delete transformerEnv[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('loads the local embedding provider once and emits progress updates', async () => {
    transformerPipeline.mockImplementation(async (_task, _model, options) => {
      options.progress_callback?.({
        loaded: 40,
        total: 80,
        status: 'Downloading local model',
      });

      return async (batch: string[]) => ({
        tolist: () => batch.map((text) => [text.length, text.length + 1]),
      });
    });

    const updates: string[] = [];
    const provider = new LocalEmbeddingProvider(makeIntelligence(), (update) => {
      updates.push(update.phase);
    });

    await provider.validate();
    const vectors = await provider.embed(['a', 'bb']);

    expect(transformerPipeline).toHaveBeenCalledOnce();
    expect(vectors).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(transformerEnv.cacheDir).toContain('.paqad/models');
    expect(transformerEnv.localModelPath).toContain('.paqad/models');
    expect(updates).toEqual(expect.arrayContaining(['load', 'download']));
  });

  it('creates and uses the OpenAI embedding provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    openAiEmbeddingsCreate
      .mockResolvedValueOnce({ data: [{ embedding: [1, 2, 3] }] })
      .mockResolvedValueOnce({
        data: [{ embedding: [3, 2, 1] }, { embedding: [2, 2, 2] }],
      });

    const provider = new OpenAiEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );

    await expect(provider.validate()).resolves.toBeUndefined();
    await expect(provider.embed(['auth', 'billing'])).resolves.toEqual([
      [3, 2, 1],
      [2, 2, 2],
    ]);
    expect(openAiCtor).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(openAiEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'validation',
    });
  });

  it('throws when the OpenAI API key is missing', async () => {
    const provider = new OpenAiEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );

    await expect(provider.embed('auth')).rejects.toThrow('Missing OPENAI_API_KEY');
  });

  it('retries rate-limited remote embedding calls before succeeding', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    openAiEmbeddingsCreate
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockResolvedValueOnce({ data: [{ embedding: [9, 9, 9] }] });

    const provider = new OpenAiEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );

    await expect(provider.embed('auth')).resolves.toEqual([[9, 9, 9]]);
    expect(openAiEmbeddingsCreate).toHaveBeenCalledTimes(2);
  }, 10000);

  it('surfaces invalid API keys with a clear provider error', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'voyage-test');
    voyageEmbed.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

    const provider = new VoyageEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'voyageai',
        embedding_model: 'voyage-code-3',
      }),
    );

    await expect(provider.validate()).rejects.toThrow('Invalid VOYAGE_API_KEY');
  });

  it('creates and uses the Voyage provider and factory selection', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'voyage-test');
    voyageEmbed.mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.9] }] }).mockResolvedValueOnce({
      data: [{ embedding: [0.4, 0.6] }, { embedding: [0.8, 0.2] }],
    });

    const provider = (await createEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'voyageai',
        embedding_model: 'voyage-code-3',
      }),
    )) as VoyageEmbeddingProvider;

    expect(provider).toBeInstanceOf(VoyageEmbeddingProvider);
    await expect(provider.validate()).resolves.toBeUndefined();
    await expect(provider.embed(['coupon', 'race condition'])).resolves.toEqual([
      [0.4, 0.6],
      [0.8, 0.2],
    ]);
    expect(voyageCtor).toHaveBeenCalledWith({ apiKey: 'voyage-test' });
    expect(voyageEmbed).toHaveBeenCalledWith({
      input: 'validation',
      model: 'voyage-code-3',
    });
  });

  it('selects provider implementations by configured provider name', async () => {
    await expect(
      createEmbeddingProvider(projectRoot, makeIntelligence({ embedding_provider: 'local' })),
    ).resolves.toBeInstanceOf(LocalEmbeddingProvider);
    await expect(
      createEmbeddingProvider(
        projectRoot,
        makeIntelligence({
          embedding_provider: 'openai',
          embedding_model: 'text-embedding-3-small',
        }),
      ),
    ).resolves.toBeInstanceOf(OpenAiEmbeddingProvider);
  });
});
