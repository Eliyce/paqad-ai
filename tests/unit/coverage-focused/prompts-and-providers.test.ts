import { checkbox } from '@inquirer/prompts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IntelligenceConfig } from '@/core/types/project-profile.js';

const mockCheckbox = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const transformerEnv = vi.hoisted(() => ({}) as Record<string, unknown>);
const transformerPipeline = vi.hoisted(() => vi.fn());
const openAiEmbeddingsCreate = vi.hoisted(() => vi.fn());
const openAiCtor = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    embeddings: { create: openAiEmbeddingsCreate },
  })),
);
const voyageCtor = vi.hoisted(() => vi.fn());

vi.mock('@inquirer/prompts', () => ({
  checkbox: mockCheckbox,
  select: mockSelect,
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

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

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

describe('coverage-focused prompt and provider branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    setInteractive(false);
  });

  afterEach(() => {
    setInteractive(false);
  });

  it('covers prompt provider validation, vue selection, and summary fallback formatting', async () => {
    setInteractive(true);
    mockCheckbox.mockImplementationOnce(async (config: Parameters<typeof checkbox>[0]) => {
      expect(config.validate?.([])).toBe('Select at least one provider.');
      expect(config.choices?.find((choice) => choice.value === 'claude-code')?.checked).toBe(true);
      expect(config.choices?.find((choice) => choice.value === 'cursor')?.checked).toBe(false);
      return ['aider'];
    });
    mockSelect
      .mockResolvedValueOnce('vue')
      .mockResolvedValueOnce('quasar')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('continue');

    const { renderStackConfirmationSummary, resolveSelections } =
      await import('@/onboarding/prompts.js');

    const result = await resolveSelections({
      detected_domain: null,
      detected_stack: null,
      detected_capabilities: [],
      confidence: 'low',
      signals: [],
      timestamp: new Date().toISOString(),
      recommended_capabilities: ['coding'],
    });

    expect(result.providers).toEqual(['aider']);
    expect(result.stack).toBe('vue');
    expect(result.capabilities).toEqual(['quasar']);

    const summary = renderStackConfirmationSummary(
      {
        detected_domain: null,
        detected_stack: null,
        detected_capabilities: [],
        confidence: 'low',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      {
        toolchains: [],
        packages: [],
        profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      {
        providers: ['codex-cli'],
        domain: 'coding',
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
    );

    expect(summary).toContain('- Version bands: none');
    expect(summary).toContain('- Packages sampled: none');
    expect(summary).toContain('- Source signals: none');
    expect(summary).toContain('- Final effective choice: coding / react');
  });

  it('covers laravel no-docker branch and fully overridden interactive bypass', async () => {
    setInteractive(true);
    mockCheckbox.mockResolvedValueOnce(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('laravel')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('none')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('none')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('continue');

    const { resolveSelections } = await import('@/onboarding/prompts.js');

    const manual = await resolveSelections({
      detected_domain: null,
      detected_stack: null,
      detected_capabilities: [],
      confidence: 'low',
      signals: [],
      timestamp: new Date().toISOString(),
      recommended_capabilities: ['coding'],
    });

    expect(manual.capabilities).toEqual([]);

    mockCheckbox.mockClear();
    mockSelect.mockClear();

    const overridden = await resolveSelections(
      {
        detected_domain: null,
        detected_stack: null,
        detected_capabilities: [],
        confidence: 'low',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      {
        providers: ['junie'],
        stack_profile: {
          frameworks: ['flutter'],
          traits: ['docker'],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        domain: 'coding',
      },
    );

    expect(overridden.providers).toEqual(['junie']);
    expect(overridden.stack).toBe('flutter');
    expect(mockCheckbox).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('covers local provider raw outputs, failure cleanup, remote retry exhaustion, and missing voyage keys', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-provider-'));
    const progress = vi.fn();

    try {
      const { LocalEmbeddingProvider, OpenAiEmbeddingProvider, VoyageEmbeddingProvider } =
        await import('@/rag/providers.js');

      transformerPipeline.mockResolvedValueOnce(async (batch: string[]) =>
        batch.map((text) => [text.length]),
      );

      const local = new LocalEmbeddingProvider(makeIntelligence(), progress);
      await expect(local.embed('abc')).resolves.toEqual([[3]]);

      transformerPipeline.mockRejectedValueOnce(new Error('network down'));
      const failingLocal = new LocalEmbeddingProvider(makeIntelligence(), progress);
      await expect(failingLocal.validate()).rejects.toThrow('network down');

      vi.stubEnv('OPENAI_API_KEY', 'sk-test');
      openAiEmbeddingsCreate.mockRejectedValue({ response: { status: 429 }, message: 'slow down' });

      const openAi = new OpenAiEmbeddingProvider(
        projectRoot,
        makeIntelligence({
          embedding_provider: 'openai',
          embedding_model: 'text-embedding-3-small',
        }),
        progress,
      );
      await expect(openAi.embed('auth')).rejects.toThrow('rate limit');
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('retrying in 250ms') }),
      );

      vi.unstubAllEnvs();
      const voyage = new VoyageEmbeddingProvider(
        projectRoot,
        makeIntelligence({
          embedding_provider: 'voyageai',
          embedding_model: 'voyage-code-3',
        }),
      );
      await expect(voyage.embed('auth')).rejects.toThrow('Missing VOYAGE_API_KEY');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 15000);
});
