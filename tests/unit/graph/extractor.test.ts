import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractGraph } from '@/graph/extractor';

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

describe('extractGraph', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-graph-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function bootstrapProject(): void {
    writeJson(join(root, '.paqad/onboarding-manifest.json'), {
      framework_version: '1.0.0',
      project_root: '.',
    });
  }

  it('throws when the onboarding manifest is missing', async () => {
    await expect(extractGraph({ projectRoot: root })).rejects.toThrow(/onboarding manifest/);
  });

  it('returns an empty graph when only the manifest exists', async () => {
    bootstrapProject();
    const graph = await extractGraph({ projectRoot: root });
    expect(graph.meta.counts).toEqual({
      modules: 0,
      files: 0,
      chunks: 0,
      symbols: 0,
      imports: 0,
    });
    expect(graph.meta.similarity_edges_available).toBe(false);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.meta.degraded_reasons).toContain(
      'chunk-index missing — file and chunk nodes unavailable',
    );
  });

  it('builds modules, files, chunks, and contains edges from artefacts', async () => {
    bootstrapProject();
    writeJson(join(root, '.paqad/module-health/cli.json'), {
      module: 'cli',
      tier: 'green',
      risk_floor: 0.2,
      complexity_correction: 1.1,
    });
    writeJson(join(root, '.paqad/module-health/graph.json'), {
      module: 'graph',
      tier: 'unknown',
    });
    writeJson(join(root, '.paqad/context/chunk-index.json'), {
      version: 1,
      generated_at: new Date().toISOString(),
      entries: [
        {
          source_file: join(root, 'src/cli/index.ts'),
          source_file_hash: 'h1',
          modified_at: new Date().toISOString(),
          chunks: [
            {
              id: 'c1',
              source_file: join(root, 'src/cli/index.ts'),
              ast_node_type: 'function',
              ast_node_path: 'f',
              exported_symbols: ['runCli'],
              content: '',
              char_count: 0,
              content_hash: 'ch1',
            },
            {
              id: 'c2',
              source_file: join(root, 'src/cli/index.ts'),
              ast_node_type: 'fallback',
              ast_node_path: 'p',
              exported_symbols: [],
              content: '',
              char_count: 0,
              content_hash: 'ch2',
            },
          ],
        },
        {
          source_file: join(root, 'README.md'),
          source_file_hash: 'h2',
          modified_at: new Date().toISOString(),
          chunks: [
            {
              id: 'c3',
              source_file: join(root, 'README.md'),
              ast_node_type: 'fallback',
              ast_node_path: 'p',
              exported_symbols: [],
              content: '',
              char_count: 0,
              content_hash: 'ch3',
            },
          ],
        },
      ],
    });

    const graph = await extractGraph({ projectRoot: root });
    expect(graph.meta.counts.modules).toBe(2);
    expect(graph.meta.counts.files).toBe(2);
    expect(graph.meta.counts.chunks).toBe(3);
    expect(graph.meta.counts.symbols).toBe(1);

    const symbolNode = graph.nodes.find((n) => n.type === 'symbol');
    expect(symbolNode?.label).toBe('runCli');
    expect(symbolNode?.parent_id).toBe('file:src/cli/index.ts');
    const definesEdge = graph.edges.find((e) => e.type === 'defines');
    expect(definesEdge?.source).toBe('file:src/cli/index.ts');

    const cliModule = graph.nodes.find((n) => n.id === 'module:cli');
    expect(cliModule?.attributes.health_tier).toBe('green');
    expect(cliModule?.attributes.risk_floor).toBe(0.2);
    expect(cliModule?.attributes.complexity_correction).toBe(1.1);

    const cliFile = graph.nodes.find((n) => n.id === 'file:src/cli/index.ts');
    expect(cliFile?.parent_id).toBe('module:cli');
    expect(cliFile?.attributes.language).toBe('typescript');
    expect(cliFile?.attributes.symbol_count).toBe(1);

    const orphanFile = graph.nodes.find((n) => n.id === 'file:README.md');
    expect(orphanFile?.parent_id).toBeNull();

    const containsModuleToFile = graph.edges.find(
      (e) => e.source === 'module:cli' && e.target === 'file:src/cli/index.ts',
    );
    expect(containsModuleToFile?.type).toBe('contains');

    const containsFileToChunk = graph.edges.filter(
      (e) => e.type === 'contains' && e.source === 'file:src/cli/index.ts',
    );
    expect(containsFileToChunk.length).toBe(2);

    expect(graph.meta.overlays_available.health).toBe(true);
    expect(graph.meta.overlays_available.risk_floor).toBe(true);
    expect(graph.meta.overlays_available.complexity_correction).toBe(true);
  });

  it('flags similarity edges as available when vector meta exists', async () => {
    bootstrapProject();
    writeJson(join(root, '.paqad/vectors/meta.json'), {
      version: 1,
      provider: 'local',
      model: 'test',
      built_at: new Date().toISOString(),
      chunk_count: 0,
      embedding_dimensions: 384,
    });
    const graph = await extractGraph({ projectRoot: root });
    expect(graph.meta.similarity_edges_available).toBe(true);
  });
});
