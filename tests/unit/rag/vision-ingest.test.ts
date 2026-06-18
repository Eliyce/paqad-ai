import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { writeProjectProfile } from '@/core/project-profile.js';
import { PatternVectorService } from '@/patterns/pattern-rag.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import { RagService } from '@/rag/service.js';
import { RagIngestError, isRagIngestError } from '@/rag/types.js';
import type {
  EmbeddingProvider,
  ProviderFactory,
  RagIngestErrorCode,
  StoredVisionChunk,
} from '@/rag/types.js';

function baseProfile(intelligence?: Partial<IntelligenceConfig>) {
  return {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['content', 'coding', 'security'] as const,
    stack_profile: {
      frameworks: ['node-cli'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- one',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'pnpm migrate',
      build: 'pnpm build',
    },
    strictness: {
      full_lane_default: false,
      require_adversarial_review: true,
      block_on_stale_docs: true,
      require_db_review_for_migrations: true,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: true,
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: { depth: 'standard' as const },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      ...intelligence,
    },
    efficiency: { differential_refresh: true },
    escalation: {
      destructive_operations: 'block' as const,
      risky_migrations: 'warn' as const,
      security_findings: 'block' as const,
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}

// Embeds text to a 2D vector keyed on a marker word so retrieval is deterministic:
// "invoice" -> [1, 0], "auth" -> [0, 1], otherwise [0.5, 0.5].
function fakeProviderFactory(): ProviderFactory {
  const provider: EmbeddingProvider = {
    name: 'local',
    model: 'fake-local',
    async validate() {
      return;
    },
    async embed(input: string | string[]) {
      const batch = Array.isArray(input) ? input : [input];
      return batch.map((text) => {
        const lower = text.toLowerCase();
        if (lower.includes('invoice')) return [1, 0];
        if (lower.includes('auth')) return [0, 1];
        return [0.5, 0.5];
      });
    },
  };

  return async () => provider;
}

function readVisionChunks(projectRoot: string): StoredVisionChunk[] {
  const raw = readFileSync(join(projectRoot, '.paqad/vectors/vision-index.json'), 'utf8');
  return (JSON.parse(raw) as { items: StoredVisionChunk[] }).items;
}

async function buildService(projectRoot: string): Promise<RagService> {
  const service = new RagService(projectRoot, fakeProviderFactory());
  await service.configureAndBuild({
    rag_enabled: true,
    embedding_provider: 'local',
    embedding_model: 'fake-local',
  });
  return service;
}

describe('RagService.ingestExtractedText', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-vision-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    vi.spyOn(PatternVectorService.prototype, 'refresh').mockResolvedValue();
    writeFileSync(
      join(projectRoot, 'src/auth.ts'),
      [
        'export function canAccessAuth() {',
        "  const authContext = 'auth policy validation for protected routes';",
        '  return authContext.length > 0;',
        '}',
        '',
      ].join('\n'),
    );
    writeProjectProfile(projectRoot, baseProfile());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('embeds and stores extracted text so retrieval can surface it', async () => {
    const service = await buildService(projectRoot);
    const imagePath = join(projectRoot, 'docs/invoice.png');
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(imagePath, 'binary-placeholder');

    const result = await service.ingestExtractedText({
      sourcePath: imagePath,
      text: 'invoice total due on receipt',
      extractionKind: 'ocr',
    });

    expect(result).toEqual({
      chunkCount: 1,
      sourcePath: imagePath,
      extractionKind: 'ocr',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'find the invoice total',
      keywords: ['invoice'],
    });

    expect(retrieval.retrieved_source_files).toContain(imagePath);
    const chunk = retrieval.retrieved_chunks.find((c) => c.source_file === imagePath);
    expect(chunk?.content).toContain('invoice');

    const stored = readVisionChunks(projectRoot);
    expect(stored).toHaveLength(1);
    expect(stored[0].extraction_kind).toBe('ocr');
    expect(stored[0].source_missing).toBe(false);
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain(
      'rag-vision-ingested',
    );
    expect((await service.getStatus()).vision_chunk_count).toBe(1);
  });

  it('replaces prior chunks for the same path instead of duplicating them', async () => {
    const service = await buildService(projectRoot);
    const imagePath = join(projectRoot, 'invoice.png');

    await service.ingestExtractedText({
      sourcePath: imagePath,
      text: 'invoice alpha first version',
      extractionKind: 'ocr',
    });
    await service.ingestExtractedText({
      sourcePath: imagePath,
      text: 'invoice beta second version',
      extractionKind: 'ocr',
    });

    const stored = readVisionChunks(projectRoot);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toContain('beta');
    expect(stored[0].content).not.toContain('alpha');

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'invoice',
      keywords: ['invoice'],
    });
    const contents = retrieval.retrieved_chunks
      .filter((c) => c.source_file === imagePath)
      .map((c) => c.content)
      .join(' ');
    expect(contents).toContain('beta');
    expect(contents).not.toContain('alpha');
  });

  it('rejects an unsupported file type and leaves the index unchanged', async () => {
    const service = await buildService(projectRoot);
    await service.ingestExtractedText({
      sourcePath: join(projectRoot, 'invoice.png'),
      text: 'invoice kept',
      extractionKind: 'ocr',
    });
    const before = readVisionChunks(projectRoot);

    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'memo.mp3'),
        text: 'invoice audio',
        extractionKind: 'ocr',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_file_type' satisfies RagIngestErrorCode });

    expect(readVisionChunks(projectRoot)).toEqual(before);
  });

  it('rejects an unknown extraction kind', async () => {
    const service = await buildService(projectRoot);
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: 'invoice text',
        // Force a kind outside the closed union to exercise runtime validation.
        extractionKind: 'transcription' as never,
      }),
    ).rejects.toMatchObject({ code: 'unknown_extraction_kind' });
  });

  it('rejects empty extracted text', async () => {
    const service = await buildService(projectRoot);
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: '',
        extractionKind: 'ocr',
      }),
    ).rejects.toMatchObject({ code: 'empty_extracted_text' });
  });

  it('rejects non-string text as empty', async () => {
    const service = await buildService(projectRoot);
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: undefined as unknown as string,
        extractionKind: 'ocr',
      }),
    ).rejects.toMatchObject({ code: 'empty_extracted_text' });
  });

  it('rejects text that is not valid UTF-8', async () => {
    const service = await buildService(projectRoot);
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: 'broken � bytes',
        extractionKind: 'caption',
      }),
    ).rejects.toMatchObject({ code: 'text_not_utf8' });
  });

  it('rejects a path that resolves outside the project root', async () => {
    const service = await buildService(projectRoot);
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, '..', 'escape.png'),
        text: 'invoice escape',
        extractionKind: 'ocr',
      }),
    ).rejects.toMatchObject({ code: 'path_outside_project' });
  });

  it('indexes a path that no longer exists on disk and marks it source_missing', async () => {
    const service = await buildService(projectRoot);
    const imagePath = join(projectRoot, 'gone.png');

    const result = await service.ingestExtractedText({
      sourcePath: imagePath,
      text: 'invoice for a deleted image',
      extractionKind: 'caption',
    });

    expect(result.chunkCount).toBeGreaterThan(0);
    const stored = readVisionChunks(projectRoot);
    expect(stored.every((c) => c.source_missing === true)).toBe(true);
  });

  it('chunks oversized text and tags every chunk with the same path and kind', async () => {
    const service = await buildService(projectRoot);
    const imagePath = join(projectRoot, 'invoice.png');
    const paragraph = 'invoice '.repeat(90); // ~630 non-whitespace chars
    const text = Array.from({ length: 5 }, () => paragraph).join('\n\n');

    const result = await service.ingestExtractedText({
      sourcePath: imagePath,
      text,
      extractionKind: 'ocr',
    });

    expect(result.chunkCount).toBeGreaterThan(1);
    const stored = readVisionChunks(projectRoot);
    expect(stored).toHaveLength(result.chunkCount);
    expect(stored.every((c) => c.source_file === imagePath)).toBe(true);
    expect(stored.every((c) => c.extraction_kind === 'ocr')).toBe(true);
  });

  it('returns both vision and file-derived chunks from a single retrieve', async () => {
    const service = await buildService(projectRoot);
    await service.ingestExtractedText({
      sourcePath: join(projectRoot, 'invoice.png'),
      text: 'invoice billing summary',
      extractionKind: 'ocr',
    });

    const sync = await service.refreshContext();
    const invoiceHits = await service.retrieve(sync, {
      taskDescription: 'invoice',
      keywords: ['invoice'],
    });
    const authHits = await service.retrieve(sync, {
      taskDescription: 'auth',
      keywords: ['auth'],
    });

    expect(invoiceHits.retrieved_source_files.some((f) => f.endsWith('invoice.png'))).toBe(true);
    expect(authHits.retrieved_source_files.some((f) => f.endsWith('auth.ts'))).toBe(true);
  });

  it('throws a clear precondition error when RAG is not configured', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: 'invoice text',
        extractionKind: 'ocr',
      }),
    ).rejects.toThrow('RAG must be enabled and configured before ingesting extracted text');
  });

  it('throws the precondition error when rag is enabled without a provider', async () => {
    writeProjectProfile(
      projectRoot,
      baseProfile({ rag_enabled: true, embedding_provider: undefined }),
    );
    const service = new RagService(projectRoot, fakeProviderFactory());
    await expect(
      service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: 'invoice text',
        extractionKind: 'ocr',
      }),
    ).rejects.toThrow('RAG must be enabled and configured before ingesting extracted text');
  });

  it('exposes RagIngestError with a stable code and type guard', async () => {
    const service = await buildService(projectRoot);
    try {
      await service.ingestExtractedText({
        sourcePath: join(projectRoot, 'invoice.png'),
        text: '',
        extractionKind: 'ocr',
      });
      throw new Error('expected ingest to reject');
    } catch (error) {
      expect(isRagIngestError(error)).toBe(true);
      expect(error).toBeInstanceOf(RagIngestError);
      expect((error as RagIngestError).name).toBe('RagIngestError');
    }
  });
});
