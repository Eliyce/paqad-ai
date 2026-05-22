import { RagService } from '@/rag/service.js';

const { promptInput, promptSelect } = vi.hoisted(() => ({
  promptInput: vi.fn(),
  promptSelect: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: promptInput,
  select: promptSelect,
}));

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
}

describe('RAG onboarding helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInteractive(false);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(RagService.prototype, 'hasApiKey').mockReturnValue(true);
    vi.spyOn(RagService.prototype, 'storeApiKey').mockReturnValue(
      '/tmp/project/.paqad/secrets.env',
    );
    vi.spyOn(RagService.prototype, 'configureAndBuild').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 123,
    });
  });

  afterEach(() => {
    setInteractive(false);
    vi.restoreAllMocks();
  });

  it('prompts for RAG setup during interactive coding onboarding', async () => {
    setInteractive(true);
    promptSelect.mockResolvedValueOnce(true).mockResolvedValueOnce('local');

    const { resolveRagSelection } = await import('@/onboarding/rag-onboarding.js');
    const result = await resolveRagSelection('coding');

    expect(promptSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Want to enable this?' }),
    );
    expect(result).toEqual({
      enabled: true,
      provider: 'local',
      model: 'Xenova/all-MiniLM-L6-v2',
    });
  });

  it('supports skipping RAG during interactive onboarding', async () => {
    setInteractive(true);
    promptSelect.mockResolvedValueOnce(false);

    const { resolveRagSelection } = await import('@/onboarding/rag-onboarding.js');
    const result = await resolveRagSelection('coding');

    expect(result).toEqual({ enabled: false });
    expect(promptSelect).toHaveBeenCalledTimes(1);
  });

  it('skips RAG prompting for content onboarding', async () => {
    setInteractive(true);

    const { resolveRagSelection } = await import('@/onboarding/rag-onboarding.js');
    const result = await resolveRagSelection('content');

    expect(result).toBeUndefined();
    expect(promptSelect).not.toHaveBeenCalled();
  });

  it('returns undefined for non-interactive coding onboarding without a preset', async () => {
    const { resolveRagSelection } = await import('@/onboarding/rag-onboarding.js');
    const result = await resolveRagSelection('coding');

    expect(result).toBeUndefined();
    expect(promptSelect).not.toHaveBeenCalled();
  });

  it('normalizes enabled presets with provider defaults', async () => {
    const { resolveRagSelection } = await import('@/onboarding/rag-onboarding.js');

    await expect(resolveRagSelection('coding', { enabled: true })).resolves.toEqual({
      enabled: true,
      provider: 'local',
      model: 'Xenova/all-MiniLM-L6-v2',
    });
  });

  it('prompts for a missing remote API key during onboarding enablement', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    promptInput.mockResolvedValueOnce('sk-live');

    const { enableRagDuringOnboarding } = await import('@/onboarding/rag-onboarding.js');
    await enableRagDuringOnboarding('/tmp/project', {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
    });

    expect(promptInput).toHaveBeenCalled();
    expect(RagService.prototype.storeApiKey).toHaveBeenCalledWith('openai', 'sk-live');
    expect(RagService.prototype.configureAndBuild).toHaveBeenCalled();
  });

  it('skips remote API key prompting when a stored key already exists', async () => {
    setInteractive(true);

    const { enableRagDuringOnboarding } = await import('@/onboarding/rag-onboarding.js');
    await enableRagDuringOnboarding('/tmp/project', {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
    });

    expect(promptInput).not.toHaveBeenCalled();
    expect(RagService.prototype.storeApiKey).not.toHaveBeenCalled();
    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        rag_enabled: true,
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
      expect.any(Function),
    );
  });

  it('returns early when onboarding enablement has no provider', async () => {
    const { enableRagDuringOnboarding } = await import('@/onboarding/rag-onboarding.js');
    await enableRagDuringOnboarding('/tmp/project', { enabled: true });

    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
  });

  it('requires a remote API key in non-interactive onboarding overrides', async () => {
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);

    const { enableRagDuringOnboarding } = await import('@/onboarding/rag-onboarding.js');
    await expect(
      enableRagDuringOnboarding('/tmp/project', {
        enabled: true,
        provider: 'voyageai',
        model: 'voyage-code-3',
      }),
    ).rejects.toThrow('Missing VOYAGE_API_KEY');
  });

  it('preserves explicit disabled presets when applying RAG selection', async () => {
    const { applyRagSelection } = await import('@/onboarding/rag-onboarding.js');

    expect(
      applyRagSelection(
        {
          rag_enabled: true,
          embedding_provider: 'local',
          embedding_model: 'Xenova/all-MiniLM-L6-v2',
          rag_similarity_threshold: 0.75,
          rag_top_n: 20,
        },
        { enabled: false },
      ),
    ).toMatchObject({
      rag_enabled: false,
      embedding_provider: undefined,
      embedding_model: undefined,
    });
  });

  it('keeps intelligence unchanged when no RAG selection is provided', async () => {
    const { applyRagSelection } = await import('@/onboarding/rag-onboarding.js');

    expect(
      applyRagSelection({
        rag_enabled: false,
        embedding_provider: undefined,
        embedding_model: undefined,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      }),
    ).toMatchObject({
      rag_enabled: false,
      embedding_provider: undefined,
      embedding_model: undefined,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
    });
  });

  it('enables the selected provider and model when applying RAG selection', async () => {
    const { applyRagSelection } = await import('@/onboarding/rag-onboarding.js');

    expect(
      applyRagSelection(
        {
          rag_enabled: false,
          embedding_provider: undefined,
          embedding_model: undefined,
          rag_similarity_threshold: 0.75,
          rag_top_n: 20,
        },
        {
          enabled: true,
          provider: 'openai',
          model: 'text-embedding-3-small',
        },
      ),
    ).toMatchObject({
      rag_enabled: true,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
    });
  });
});
