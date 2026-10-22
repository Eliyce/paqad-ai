import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import { EmbeddingProviderError } from '@/rag/types.js';
import {
  createEmbeddingProvider,
  LocalEmbeddingProvider,
  OpenAiEmbeddingProvider,
} from '@/rag/providers.js';
import {
  REMOVED_EMBEDDING_PROVIDER_MESSAGE,
  RemovedEmbeddingProviderError,
} from '@/rag/removed-provider.js';

const transformerEnv: Record<string, unknown> = {};
const transformerPipeline = vi.fn();
const openAiEmbeddingsCreate = vi.fn();
const openAiCtor = vi.fn().mockImplementation(function () {
  return {
    embeddings: {
      create: openAiEmbeddingsCreate,
    },
  };
});
const loadOptionalPackageSpy = vi.hoisted(() => vi.fn());

vi.mock('@/core/optional-package.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/optional-package.js')>();
  loadOptionalPackageSpy.mockImplementation(actual.loadOptionalPackage);
  return { ...actual, loadOptionalPackage: loadOptionalPackageSpy };
});

vi.mock('@huggingface/transformers', () => ({
  env: transformerEnv,
  pipeline: transformerPipeline,
}));

vi.mock('openai', () => ({
  OpenAI: openAiCtor,
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

  it('AC-26 retries a 429 and succeeds on the following 200', async () => {
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

  it('AC-26 surfaces a 401 as Invalid OPENAI_API_KEY', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    openAiEmbeddingsCreate.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

    const provider = new OpenAiEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );

    await expect(provider.validate()).rejects.toThrow('Invalid OPENAI_API_KEY');
    expect(openAiEmbeddingsCreate).toHaveBeenCalledOnce();
  });

  it('AC-26 retries repeated 429s at 250, 500 and 1000 ms, then reports rate_limited', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const updates: string[] = [];
    const provider = new OpenAiEmbeddingProvider(
      projectRoot,
      makeIntelligence({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
      (update) => updates.push(update.message),
    );
    openAiEmbeddingsCreate.mockResolvedValueOnce({ data: [{ embedding: [1] }] });
    await provider.validate();
    vi.useFakeTimers();
    openAiEmbeddingsCreate.mockRejectedValue({ status: 429, message: 'Too many requests' });

    const outcome = provider.embed('auth').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(250 + 500 + 1000);
    const error = await outcome;

    expect(error).toBeInstanceOf(EmbeddingProviderError);
    expect((error as EmbeddingProviderError).code).toBe('rate_limited');
    expect(openAiEmbeddingsCreate).toHaveBeenCalledTimes(5);
    expect(updates).toEqual([
      'openai embedding rate limit reached; retrying in 250ms',
      'openai embedding rate limit reached; retrying in 500ms',
      'openai embedding rate limit reached; retrying in 1000ms',
    ]);
    openAiEmbeddingsCreate.mockReset();
  });

  it('AC-14 refuses a removed provider name instead of returning another provider', async () => {
    const removed = makeIntelligence({
      embedding_provider: 'voyageai' as IntelligenceConfig['embedding_provider'],
    });

    await expect(createEmbeddingProvider(projectRoot, removed)).rejects.toThrow(
      REMOVED_EMBEDDING_PROVIDER_MESSAGE,
    );
    expect(loadOptionalPackageSpy).not.toHaveBeenCalled();
    expect(transformerPipeline).not.toHaveBeenCalled();
    expect(openAiCtor).not.toHaveBeenCalled();
  });

  it('refuses a saved voyageai setting when the resolved provider is unset', async () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', '.config'), 'rag_embedding_provider=voyageai\n');

    const error = await createEmbeddingProvider(
      projectRoot,
      makeIntelligence({ embedding_provider: undefined }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RemovedEmbeddingProviderError);
    expect((error as Error).message).toContain('local');
    expect((error as Error).message).toContain('openai');
    expect(readdirSync(join(projectRoot, '.paqad'))).toEqual(['.config']);
  });

  it('AC-14 never returns a Voyage provider or loads voyageai for any provider setting', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    openAiEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [1] }] });
    transformerPipeline.mockResolvedValue(async () => [[1]]);
    const returned: string[] = [];

    for (const name of ['local', 'openai', 'voyageai', undefined]) {
      const provider = await createEmbeddingProvider(
        projectRoot,
        makeIntelligence({
          embedding_provider: name as IntelligenceConfig['embedding_provider'],
        }),
      ).catch(() => undefined);
      if (provider) returned.push(provider.constructor.name);
      await provider?.embed('probe');
    }

    expect(returned).toEqual([
      LocalEmbeddingProvider.name,
      OpenAiEmbeddingProvider.name,
      LocalEmbeddingProvider.name,
    ]);
    expect(loadOptionalPackageSpy.mock.calls.map(([name]) => name)).not.toContain('voyageai');
    expect(loadOptionalPackageSpy.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(['@huggingface/transformers', 'openai']),
    );
    openAiEmbeddingsCreate.mockReset();
    transformerPipeline.mockReset();
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
