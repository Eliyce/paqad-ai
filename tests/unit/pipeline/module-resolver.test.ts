import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ChunkIndexManager } from '@/context/chunk-index.js';
import { ModuleResolver } from '@/pipeline/module-resolver.js';
import { RagService } from '@/rag/service.js';

describe('ModuleResolver', () => {
  it('resolves explicit paths and basename matches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-modules-'));
    mkdirSync(join(root, 'src/path'), { recursive: true });
    writeFileSync(join(root, 'src/path/file.ts'), 'export const x = true;\n');
    const resolver = new ModuleResolver(root, {
      stack_profile: {
        frameworks: ['react'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    const result = await resolver.resolve('Update src/path/file.ts and src/path/file');
    expect(result.source).toBe('explicit-path');
    expect(result.modules.map((entry) => entry.path)).toContain('src/path/file');
  });

  it('uses chunk-index symbols when explicit paths are missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-modules-'));
    vi.spyOn(ChunkIndexManager.prototype, 'load').mockResolvedValue({
      version: 1,
      generated_at: new Date().toISOString(),
      entries: [
        {
          source_file: join(root, 'src/AuthService.ts'),
          source_file_hash: 'hash',
          modified_at: new Date().toISOString(),
          chunks: [
            {
              id: '1',
              source_file: join(root, 'src/AuthService.ts'),
              ast_node_type: 'class',
              ast_node_path: 'AuthService',
              exported_symbols: ['AuthService'],
              content: 'export class AuthService {}',
              char_count: 10,
              content_hash: 'hash',
            },
          ],
        },
      ],
    });
    const resolver = new ModuleResolver(root, {
      stack_profile: {
        frameworks: ['react'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });
    const result = await resolver.resolve('Fix AuthService');
    expect(result.source).toBe('symbol-index');
    expect(result.modules[0]?.path).toBe('src/AuthService');
  });

  it('uses RAG when enabled and falls back to heuristics when RAG fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-modules-'));
    vi.spyOn(ChunkIndexManager.prototype, 'load').mockResolvedValue(null);
    vi.spyOn(RagService.prototype, 'retrieveForEval').mockResolvedValue({
      vector_scores: new Map(),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['1'],
      retrieved_source_files: [join(root, 'src/components/Card.tsx')],
      retrieved_chunks: [
        { id: '1', source_file: join(root, 'src/components/Card.tsx'), content: '' },
      ],
    });

    const resolver = new ModuleResolver(root, {
      intelligence: { rag_enabled: true },
      stack_profile: {
        frameworks: ['react'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });
    const result = await resolver.resolve('Update card');
    expect(result.source).toBe('rag');
    expect(result.modules[0]?.path).toBe('src/components/Card');

    vi.spyOn(RagService.prototype, 'retrieveForEval').mockRejectedValueOnce(new Error('boom'));
    const fallback = await resolver.resolve('Update dashboard api route');
    expect(fallback.source).toBe('stack-heuristic');
    expect(fallback.modules.map((entry) => entry.path)).toContain('src/api');
  });
});
