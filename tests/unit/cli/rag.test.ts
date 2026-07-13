import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RagService } from '@/rag/service.js';
import { EmbeddingProviderError } from '@/rag/types.js';

const { promptConfirm, promptInput, promptSelect } = vi.hoisted(() => ({
  promptConfirm: vi.fn(),
  promptInput: vi.fn(),
  promptSelect: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: promptConfirm,
  input: promptInput,
  select: promptSelect,
}));

async function loadCreateRagCommand() {
  const module = await import('@/cli/commands/rag.js');
  return module.createRagCommand;
}

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
}

function projectRoot(root: string | null): string {
  if (!root) {
    throw new Error('Expected test project root to be initialized');
  }
  return root;
}

describe('rag command', () => {
  let tempProjectRoot: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    tempProjectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-cli-'));
    setInteractive(false);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: false,
      configured_provider: undefined,
      configured_model: undefined,
      index_present: false,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });
    vi.spyOn(RagService.prototype, 'configureAndBuild').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 123,
    });
    vi.spyOn(RagService.prototype, 'rebuild').mockResolvedValue();
    vi.spyOn(RagService.prototype, 'clear').mockResolvedValue();
    vi.spyOn(RagService.prototype, 'refreshContext').mockResolvedValue({
      index: { version: 1, generated_at: '', entries: [] },
      changed_files: [],
      added_files: [],
      deleted_files: [],
      updated: false,
    });
    vi.spyOn(RagService.prototype, 'retrieve').mockResolvedValue({
      vector_scores: new Map(),
      chunks_retrieved: 0,
      retrieved_chunk_ids: [],
      retrieved_source_files: [],
      retrieved_chunks: [],
    });
    vi.spyOn(RagService.prototype, 'hasApiKey').mockReturnValue(true);
    vi.spyOn(RagService.prototype, 'storeApiKey').mockReturnValue(
      '/tmp/project/.paqad/secrets.env',
    );
    promptConfirm.mockResolvedValue(true);
    promptInput.mockResolvedValue('sk-prompted');
    promptSelect.mockResolvedValue('local');
  });

  afterEach(() => {
    setInteractive(false);
    if (tempProjectRoot && existsSync(tempProjectRoot)) {
      rmSync(tempProjectRoot, { recursive: true, force: true });
    }
    tempProjectRoot = null;
    // `rag eval --mode feature-off-vs-on` sets a non-zero exit code on a failed
    // gate; reset it so it never leaks into the vitest process exit (F15).
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('initializes RAG with explicit local provider settings', async () => {
    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'local',
        '--yes',
      ],
      { from: 'node' },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        rag_enabled: true,
        embedding_provider: 'local',
      }),
      expect.any(Function),
    );
    expect(readFileSync(join(projectRoot(tempProjectRoot), '.paqad/.gitignore'), 'utf8')).toContain(
      'vectors/',
    );
  });

  it('refresh-context recomposes rule-only when rag is off (issue #284, no provider work)', async () => {
    const writes: string[] = [];
    (process.stdout.write as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      },
    );
    const refreshContext = vi.spyOn(RagService.prototype, 'refreshContext');
    const retrieve = vi.spyOn(RagService.prototype, 'retrieveForEval');

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      ['node', 'rag', 'refresh-context', '--project-root', projectRoot(tempProjectRoot)],
      { from: 'node' },
    );

    // The lean (rag-off) path recomposes rule-only and never touches the index or
    // retrieval — no embedding/index/provider call happens.
    expect(writes.join('')).toContain('rule-only (rag off)');
    expect(refreshContext).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('refresh-context keeps the code-knowledge index fresh on the same worker (issue #353)', async () => {
    const refreshModule = await import('@/code-knowledge/refresh.js');
    const spy = vi
      .spyOn(refreshModule, 'refreshCodeKnowledgeIndex')
      .mockResolvedValue({ refreshed: false, reason: 'no-index', reparsed: [] });

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      ['node', 'rag', 'refresh-context', '--project-root', projectRoot(tempProjectRoot)],
      { from: 'node' },
    );

    expect(spy).toHaveBeenCalledWith(projectRoot(tempProjectRoot));
    spy.mockRestore();
  });

  it('refresh-context swallows a code-knowledge refresh failure and still recomposes', async () => {
    const writes: string[] = [];
    (process.stdout.write as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      },
    );
    const refreshModule = await import('@/code-knowledge/refresh.js');
    const spy = vi
      .spyOn(refreshModule, 'refreshCodeKnowledgeIndex')
      .mockRejectedValue(new Error('boom'));

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      ['node', 'rag', 'refresh-context', '--project-root', projectRoot(tempProjectRoot)],
      { from: 'node' },
    );

    // The failure is swallowed; the context recompose still runs to completion.
    expect(writes.join('')).toContain('rule-only (rag off)');
    spy.mockRestore();
  });

  it('#354: refresh-context records a `used` event with what it delivered (rag on)', async () => {
    const root = projectRoot(tempProjectRoot);
    // Enable rag via the git-ignored local .config (the enablement surface the worker reads).
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/.config'), 'rag_enabled=true\nrag_embedding_provider=local\n');

    // Deliver one above-floor slice; stub the other RAG-tier layers so the compose is
    // deterministic and the assertion isolates the `used` accounting.
    const retrievalMod = await import('@/context/retrieval-context.js');
    vi.spyOn(retrievalMod, 'gatherWorkingSetSlices').mockResolvedValue({
      slices: [{ source_file: 'docs/instructions/a.md', content: 'a slice', score: 0.9 }],
      bestScore: 0.9,
    });
    const driftMod = await import('@/rag/base-drift.js');
    vi.spyOn(driftMod, 'refreshBaseDrift').mockResolvedValue(undefined);
    vi.spyOn(driftMod, 'loadBaseDrift').mockReturnValue(null);
    vi.spyOn(driftMod, 'composeBaseDriftSection').mockReturnValue('');
    const memoryMod = await import('@/context/codebase-memory.js');
    vi.spyOn(memoryMod, 'gatherCodebaseMemory').mockReturnValue('');
    const recorderMod = await import('@/rag-ledger/recorder.js');
    const record = vi.spyOn(recorderMod, 'recordRagEvidence').mockReturnValue(null);

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      ['node', 'rag', 'refresh-context', '--project-root', root, '--quiet'],
      { from: 'node' },
    );

    const usedCall = record.mock.calls.find((call) => call[1] === 'used');
    expect(usedCall).toBeDefined();
    expect(usedCall?.[2]).toMatchObject({
      injected: true,
      slice_count: 1,
      pointer_count: 0,
      score_top: 0.9,
      injected_sections: expect.arrayContaining(['retrieval']),
    });
    expect((usedCall?.[2] as { bytes_injected: number }).bytes_injected).toBeGreaterThan(0);
  });

  it('#354: records an honest injected:false `used` row when retrieval goes dark', async () => {
    const root = projectRoot(tempProjectRoot);
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/.config'), 'rag_enabled=true\nrag_embedding_provider=local\n');

    // Non-quiet run so the worker's enabled summary line is exercised too.
    const writes: string[] = [];
    (process.stdout.write as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      },
    );

    const retrievalMod = await import('@/context/retrieval-context.js');
    // Dark: no slices, but a best score below the relief band.
    vi.spyOn(retrievalMod, 'gatherWorkingSetSlices').mockResolvedValue({
      slices: [],
      bestScore: 0.3,
    });
    const driftMod = await import('@/rag/base-drift.js');
    vi.spyOn(driftMod, 'refreshBaseDrift').mockResolvedValue(undefined);
    vi.spyOn(driftMod, 'loadBaseDrift').mockReturnValue(null);
    vi.spyOn(driftMod, 'composeBaseDriftSection').mockReturnValue('');
    const memoryMod = await import('@/context/codebase-memory.js');
    vi.spyOn(memoryMod, 'gatherCodebaseMemory').mockReturnValue('');
    const recorderMod = await import('@/rag-ledger/recorder.js');
    const record = vi.spyOn(recorderMod, 'recordRagEvidence').mockReturnValue(null);

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      ['node', 'rag', 'refresh-context', '--project-root', root],
      { from: 'node' },
    );

    const usedCall = record.mock.calls.find((call) => call[1] === 'used');
    expect(usedCall?.[2]).toMatchObject({
      injected: false,
      slice_count: 0,
      pointer_count: 0,
      score_top: 0.3,
    });
    expect((usedCall?.[2] as { injected_sections: string[] }).injected_sections).not.toContain(
      'retrieval',
    );
    // The enabled summary line reports the slice count.
    expect(writes.join('')).toContain('slices: 0');
  });

  it('#354: a broad working set distils to a context pack and records pointer_count', async () => {
    const root = projectRoot(tempProjectRoot);
    mkdirSync(join(root, '.paqad/context'), { recursive: true });
    writeFileSync(join(root, '.paqad/.config'), 'rag_enabled=true\nrag_embedding_provider=local\n');

    // Real doc files so the worker's distil readFile path is exercised; one slice points
    // at a MISSING file to cover the reader's catch branch (returns undefined).
    mkdirSync(join(root, 'docs/instructions'), { recursive: true });
    const manySlices = Array.from({ length: 8 }, (_unused, i) => {
      const rel = `docs/instructions/a-${i}.md`;
      if (i < 7) writeFileSync(join(root, rel), `line one for ${i}\nline two\nline three\n`);
      return { source_file: rel, content: `line one for ${i}`, score: 0.9 };
    });

    const retrievalMod = await import('@/context/retrieval-context.js');
    vi.spyOn(retrievalMod, 'gatherWorkingSetSlices').mockResolvedValue({
      slices: manySlices,
      bestScore: 0.9,
    });
    const driftMod = await import('@/rag/base-drift.js');
    vi.spyOn(driftMod, 'refreshBaseDrift').mockResolvedValue(undefined);
    vi.spyOn(driftMod, 'loadBaseDrift').mockReturnValue(null);
    vi.spyOn(driftMod, 'composeBaseDriftSection').mockReturnValue('');
    const memoryMod = await import('@/context/codebase-memory.js');
    vi.spyOn(memoryMod, 'gatherCodebaseMemory').mockReturnValue('');
    const recorderMod = await import('@/rag-ledger/recorder.js');
    const record = vi.spyOn(recorderMod, 'recordRagEvidence').mockReturnValue(null);

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      ['node', 'rag', 'refresh-context', '--project-root', root, '--quiet'],
      { from: 'node' },
    );

    const usedCall = record.mock.calls.find((call) => call[1] === 'used');
    const used = usedCall?.[2] as {
      injected: boolean;
      slice_count: number;
      pointer_count: number;
      score_top: number;
    };
    expect(used.injected).toBe(true);
    expect(used.slice_count).toBe(0);
    expect(used.pointer_count).toBeGreaterThan(0);
    expect(used.score_top).toBe(0.9);
  });

  it('#354: probe prints the pre-floor scores annotated against the floor + relief band', async () => {
    const writes: string[] = [];
    (process.stdout.write as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      },
    );
    vi.spyOn(RagService.prototype, 'probe').mockResolvedValue([
      { id: 'c1', source_file: 'src/a.ts', content: 'x', score: 0.42 },
      { id: 'c2', source_file: 'src/b.ts', content: 'y', score: 0.2 },
    ]);

    const createRagCommand = await loadCreateRagCommand();
    await createRagCommand().parseAsync(
      [
        'node',
        'rag',
        'probe',
        'how does retrieval work',
        '--project-root',
        projectRoot(tempProjectRoot),
      ],
      { from: 'node' },
    );

    const out = JSON.parse(writes.join(''));
    expect(out.best_score).toBe(0.42);
    expect(out.similarity_threshold).toBe(0.75);
    expect(out.relief_floor).toBe(0.35);
    // 0.42 is above the relief band but below the floor; 0.2 is below both.
    expect(out.rows[0]).toMatchObject({ above_floor: false, above_relief: true });
    expect(out.rows[1]).toMatchObject({ above_floor: false, above_relief: false });
  });

  it('F23: lets the user opt into the code-tuned local model interactively', async () => {
    setInteractive(true);
    // provider picker -> local, then the local-model picker -> code-tuned jina.
    promptSelect
      .mockResolvedValueOnce('local')
      .mockResolvedValueOnce('Xenova/jina-embeddings-v2-base-code');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'init', '--project-root', projectRoot(tempProjectRoot), '--yes'],
      { from: 'node' },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding_provider: 'local',
        embedding_model: 'Xenova/jina-embeddings-v2-base-code',
      }),
      expect.any(Function),
    );
  });

  it('prompts for provider interactively when none is specified', async () => {
    setInteractive(true);
    promptSelect.mockResolvedValueOnce('voyageai');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'init', '--project-root', projectRoot(tempProjectRoot), '--yes'],
      {
        from: 'node',
      },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding_provider: 'voyageai',
      }),
      expect.any(Function),
    );
  });

  it('falls back to interactive provider selection when an explicit provider is invalid', async () => {
    setInteractive(true);
    promptSelect.mockResolvedValueOnce('openai');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'not-a-provider',
        '--yes',
      ],
      { from: 'node' },
    );

    expect(promptSelect).toHaveBeenCalled();
    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding_provider: 'openai',
      }),
      expect.any(Function),
    );
  });

  it('returns the existing index status without rebuilding in non-interactive mode', async () => {
    vi.mocked(RagService.prototype.getStatus).mockResolvedValueOnce({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 123,
    });

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'init', '--project-root', projectRoot(tempProjectRoot)],
      {
        from: 'node',
      },
    );

    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalled();
  });

  it('uses the current configured provider in non-interactive mode when no provider is specified', async () => {
    vi.mocked(RagService.prototype.getStatus).mockResolvedValueOnce({
      enabled: false,
      configured_provider: 'openai',
      configured_model: 'text-embedding-3-small',
      index_present: false,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(true);

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'init', '--project-root', projectRoot(tempProjectRoot), '--yes'],
      { from: 'node' },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
      expect.any(Function),
    );
  });

  it('defaults to local provider in non-interactive mode when no provider is configured', async () => {
    vi.mocked(RagService.prototype.getStatus).mockResolvedValueOnce({
      enabled: false,
      configured_provider: undefined,
      configured_model: undefined,
      index_present: false,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'init', '--project-root', projectRoot(tempProjectRoot), '--yes'],
      { from: 'node' },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding_provider: 'local',
      }),
      expect.any(Function),
    );
  });

  it('returns existing index status without rebuilding when interactive user declines rebuild', async () => {
    setInteractive(true);
    promptConfirm.mockResolvedValueOnce(false);
    vi.mocked(RagService.prototype.getStatus).mockResolvedValueOnce({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 123,
    });

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'init', '--project-root', projectRoot(tempProjectRoot)],
      {
        from: 'node',
      },
    );

    expect(RagService.prototype.configureAndBuild).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalled();
  });

  it('requires API keys for remote providers in non-interactive mode', async () => {
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'openai',
          '--yes',
        ],
        {
          from: 'node',
        },
      ),
    ).rejects.toThrow('Missing OPENAI_API_KEY');

    expect(RagService.prototype.storeApiKey).not.toHaveBeenCalled();
  });

  it('requires Voyage AI API keys for remote providers in non-interactive mode', async () => {
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'voyageai',
          '--yes',
        ],
        {
          from: 'node',
        },
      ),
    ).rejects.toThrow('Missing VOYAGE_API_KEY');
  });

  it('uses the api-key prompt validator to reject blank values', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    promptInput.mockResolvedValueOnce('sk-test');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'openai',
        '--yes',
      ],
      { from: 'node' },
    );

    const promptOptions = promptInput.mock.calls[0]?.[0] as {
      validate: (value: string) => true | string;
    };
    expect(promptOptions.validate('   ')).toBe('API key is required');
    expect(promptOptions.validate('sk-valid')).toBe(true);
  });

  it('prompts for the Voyage AI key and trims it before storing', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    promptInput.mockResolvedValueOnce('  voyage-key  ');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'voyageai',
        '--yes',
      ],
      { from: 'node' },
    );

    expect(promptInput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Enter your Voyage AI API key',
      }),
    );
    expect(RagService.prototype.storeApiKey).toHaveBeenCalledWith('voyageai', 'voyage-key');
  });

  it('rethrows build errors immediately in non-interactive mode', async () => {
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce(new Error('boom'));

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'local',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('boom');
  });

  it('rebuilds the vector index and prints progress', async () => {
    vi.mocked(RagService.prototype.rebuild).mockImplementation(async ({ onProgress }) => {
      onProgress?.({
        phase: 'build',
        message: 'Embedding chunks',
        percent: 50,
      });
    });

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'rebuild', '--project-root', projectRoot(tempProjectRoot)],
      {
        from: 'node',
      },
    );

    expect(RagService.prototype.rebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        onProgress: expect.any(Function),
      }),
    );
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('[4/4] Finalizing RAG indexes and metadata'),
    );
    expect(process.stderr.write).toHaveBeenCalledWith('  >  50%  Embedding chunks\n');
  });

  it('refuses to clear the index without confirmation in non-interactive mode', async () => {
    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();

    await expect(
      command.parseAsync(['node', 'rag', 'clear', '--project-root', projectRoot(tempProjectRoot)], {
        from: 'node',
      }),
    ).rejects.toThrow('Refusing to clear RAG index without --yes in non-interactive mode');
  });

  it('does not clear the index when interactive user declines confirmation', async () => {
    setInteractive(true);
    promptConfirm.mockResolvedValueOnce(false);

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'clear', '--project-root', projectRoot(tempProjectRoot)],
      {
        from: 'node',
      },
    );

    expect(RagService.prototype.clear).not.toHaveBeenCalled();
  });

  it('reports status and clears the index', async () => {
    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'status', '--project-root', projectRoot(tempProjectRoot)],
      {
        from: 'node',
      },
    );
    await command.parseAsync(
      ['node', 'rag', 'clear', '--project-root', projectRoot(tempProjectRoot), '--yes'],
      { from: 'node' },
    );

    expect(RagService.prototype.getStatus).toHaveBeenCalled();
    expect(RagService.prototype.clear).toHaveBeenCalled();
  });

  it('runs the on/off A/B gate and emits off/on snapshots + gate verdict (F15)', async () => {
    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(['node', 'rag', 'eval', '--mode', 'feature-off-vs-on'], {
      from: 'node',
    });

    expect(RagService.prototype.refreshContext).toHaveBeenCalledTimes(1);
    expect(RagService.prototype.retrieve).toHaveBeenCalled();
    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty('eval_run');
    expect(parsed).toHaveProperty('feature_off_snapshot');
    expect(parsed).toHaveProperty('feature_on_snapshot');
    expect(parsed).toHaveProperty('gate_passed');
    expect((parsed.eval_run as Record<string, unknown>)['mode']).toBe('feature-off-vs-on');
    // The mocked retrieval returns no hits, so feature-ON does not beat OFF: the
    // gate fails and the merge is blocked via a non-zero exit code.
    expect(parsed.gate_passed).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('includes comparison in output when --baseline is provided', async () => {
    const { writeFileSync } = await import('node:fs');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'paqad-rag-eval-'));
    const baselinePath = join(dir, 'baseline.json');
    writeFileSync(
      baselinePath,
      JSON.stringify({
        hit_at_5: 0.5,
        task_success_rate: 0.4,
        correction_turns: 2,
        prompt_tokens_sent: 8000,
        task_count: 12,
      }),
    );

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'eval', '--mode', 'rag-vs-candidate', '--baseline', baselinePath],
      { from: 'node' },
    );

    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty('comparison');
    expect(parsed.comparison).not.toBeNull();
    expect((parsed.comparison as Record<string, unknown>)['mode']).toBe('rag-vs-candidate');
  });

  it('defaults eval mode to rag-vs-candidate when baseline comparison is requested without --mode', async () => {
    const { writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'paqad-rag-eval-default-mode-'));
    const baselinePath = join(dir, 'baseline.json');
    writeFileSync(
      baselinePath,
      JSON.stringify({
        hit_at_5: 0.5,
        task_success_rate: 0.4,
        correction_turns: 2,
        prompt_tokens_sent: 8000,
        task_count: 12,
      }),
    );

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(['node', 'rag', 'eval', '--baseline', baselinePath], {
      from: 'node',
    });

    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as {
      eval_run: { mode: string };
      comparison: { mode: string };
    };
    expect(parsed.eval_run.mode).toBe('rag-vs-candidate');
    expect(parsed.comparison.mode).toBe('rag-vs-candidate');
  });

  it('runs the optional model-graded lane only through the eval command flag', async () => {
    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(['node', 'rag', 'eval', '--model-graded'], {
      from: 'node',
    });

    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.eval_run as Record<string, unknown>).toHaveProperty('model_graded');
  });

  it('uses retrieved source files in eval traces so hit@k can match expected files', async () => {
    vi.mocked(RagService.prototype.retrieve).mockResolvedValueOnce({
      vector_scores: new Map([['chunk-1', 0.9]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['chunk-1'],
      retrieved_source_files: ['/abs/project/src/security/auth-gates.ts'],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: '/abs/project/src/security/auth-gates.ts',
          content: 'authorization gate implementation',
        },
      ],
    });

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(['node', 'rag', 'eval'], { from: 'node' });

    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as {
      candidate_snapshot: { hit_at_5: number };
      eval_run: { traces: Array<{ first_stage_chunk_ids: string[] }> };
    };

    expect(parsed.eval_run.traces[0]?.first_stage_chunk_ids).toContain(
      '/abs/project/src/security/auth-gates.ts',
    );
    expect(parsed.candidate_snapshot.hit_at_5).toBeGreaterThan(0);
  });

  it('does not fabricate routed workflow IDs from dataset expectations during eval', async () => {
    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(['node', 'rag', 'eval'], { from: 'node' });

    const output = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as {
      eval_run: { traces: Array<{ item_id: string; routed_workflow_id?: string }> };
    };

    const workflowTrace = parsed.eval_run.traces.find((trace) => trace.item_id === 'wt-1');
    expect(workflowTrace?.routed_workflow_id).toBeUndefined();
  });

  it('retries with a new API key when interactive remote setup fails validation', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    vi.mocked(RagService.prototype.configureAndBuild)
      .mockRejectedValueOnce(
        new EmbeddingProviderError('openai', 'invalid_api_key', 'Invalid OPENAI_API_KEY'),
      )
      .mockResolvedValueOnce({
        enabled: true,
        configured_provider: 'openai',
        configured_model: 'text-embedding-3-small',
        index_present: true,
        valid: true,
        chunk_count: 1,
        size_bytes: 123,
      });
    promptInput.mockResolvedValueOnce('sk-bad').mockResolvedValueOnce('sk-good');
    promptSelect.mockResolvedValueOnce('retry-key');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'openai',
        '--yes',
      ],
      { from: 'node' },
    );

    expect(RagService.prototype.storeApiKey).toHaveBeenNthCalledWith(1, 'openai', 'sk-bad');
    expect(RagService.prototype.storeApiKey).toHaveBeenNthCalledWith(2, 'openai', 'sk-good');
    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledTimes(2);
  });

  it('retries local provider download when user confirms retry', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.configureAndBuild)
      .mockRejectedValueOnce(
        new EmbeddingProviderError('local', 'download_failed', 'Download failed'),
      )
      .mockResolvedValueOnce({
        enabled: true,
        configured_provider: 'local',
        configured_model: 'Xenova/all-MiniLM-L6-v2',
        index_present: true,
        valid: true,
        chunk_count: 1,
        size_bytes: 123,
      });
    promptConfirm.mockResolvedValueOnce(true);

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'local',
        '--yes',
      ],
      { from: 'node' },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenCalledTimes(2);
  });

  it('throws local provider error when user declines retry', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce(
      new EmbeddingProviderError('local', 'download_failed', 'Download failed'),
    );
    promptConfirm.mockResolvedValueOnce(false);

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'local',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('Download failed');
  });

  it('formats missing remote API key failures without retry guidance', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(true);
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce(
      new EmbeddingProviderError('openai', 'missing_api_key', 'Missing OPENAI_API_KEY'),
    );
    promptSelect.mockResolvedValueOnce('cancel');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'openai',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('Missing OPENAI_API_KEY');

    expect(process.stderr.write).toHaveBeenCalledWith('Missing OPENAI_API_KEY\n');
  });

  it('throws non-provider errors immediately in interactive recovery flow', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce(new Error('boom'));

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'local',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('boom');
  });

  it('prints non-Error failures in interactive recovery flow before rethrowing', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce('raw failure');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'local',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toBe('raw failure');

    expect(process.stderr.write).toHaveBeenCalledWith('raw failure\n');
  });

  it('throws when interactive remote setup is cancelled', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce(
      new EmbeddingProviderError('openai', 'rate_limited', 'Rate limited'),
    );
    promptInput.mockResolvedValueOnce('sk-bad');
    promptSelect.mockResolvedValueOnce('cancel');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'openai',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('Rate limited');
  });

  it('formats generic provider errors via the interactive recovery path', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    vi.mocked(RagService.prototype.configureAndBuild).mockRejectedValueOnce(
      new EmbeddingProviderError('openai', 'provider_error', 'Provider broke'),
    );
    promptInput.mockResolvedValueOnce('sk-bad');
    promptSelect.mockResolvedValueOnce('cancel');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await expect(
      command.parseAsync(
        [
          'node',
          'rag',
          'init',
          '--project-root',
          projectRoot(tempProjectRoot),
          '--provider',
          'openai',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('Provider broke');

    expect(process.stderr.write).toHaveBeenCalledWith('Provider broke\n');
  });

  it('prints progress updates without percent prefixes when percent is absent', async () => {
    vi.mocked(RagService.prototype.rebuild).mockImplementation(async ({ onProgress }) => {
      onProgress?.({
        phase: 'build',
        message: 'Done without percent',
      });
    });

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      ['node', 'rag', 'rebuild', '--project-root', projectRoot(tempProjectRoot)],
      {
        from: 'node',
      },
    );

    expect(process.stderr.write).toHaveBeenCalledWith('  > Done without percent\n');
  });

  it('drops an explicit model override when the user switches providers interactively', async () => {
    setInteractive(true);
    vi.mocked(RagService.prototype.hasApiKey).mockReturnValue(false);
    vi.mocked(RagService.prototype.configureAndBuild)
      .mockRejectedValueOnce(
        new EmbeddingProviderError('openai', 'invalid_api_key', 'Invalid OPENAI_API_KEY'),
      )
      .mockResolvedValueOnce({
        enabled: true,
        configured_provider: 'local',
        configured_model: 'Xenova/all-MiniLM-L6-v2',
        index_present: true,
        valid: true,
        chunk_count: 1,
        size_bytes: 123,
      });
    promptInput.mockResolvedValueOnce('sk-bad');
    // switch-provider -> pick local -> then the F23 local-model picker (MiniLM floor).
    promptSelect
      .mockResolvedValueOnce('switch-provider')
      .mockResolvedValueOnce('local')
      .mockResolvedValueOnce('Xenova/all-MiniLM-L6-v2');

    const createRagCommand = await loadCreateRagCommand();
    const command = createRagCommand();
    await command.parseAsync(
      [
        'node',
        'rag',
        'init',
        '--project-root',
        projectRoot(tempProjectRoot),
        '--provider',
        'openai',
        '--model',
        'text-embedding-3-small',
        '--yes',
      ],
      { from: 'node' },
    );

    expect(RagService.prototype.configureAndBuild).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        embedding_provider: 'local',
        embedding_model: 'Xenova/all-MiniLM-L6-v2',
      }),
      expect.any(Function),
    );
  });
});
