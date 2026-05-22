import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SemanticLoader } from '@/context/semantic-loader.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { RelevanceScorer } from '@/context/relevance-scorer.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { RagService } from '@/rag/service.js';
import * as projectPacks from '@/packs/project-packs.js';

type FrameworkPack = ReturnType<typeof projectPacks.getPacksForFrameworks>[number];

describe('SemanticLoader', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-semantic-loader-'));
    mkdirSync(join(projectRoot, 'src/components'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/components/App.vue'),
      '<script setup lang="ts">const route = "/billing";</script>\n<template><div /></template>\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/App.tsx'),
      'export function App() { return <div>billing</div>; }\n',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('loads pack-declared AST extensions for matched stacks', async () => {
    writeProjectProfile(projectRoot, baseProfile(['vue']));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-1',
    }).load(
      [
        { path: join(projectRoot, 'src/components/App.vue'), content: 'vue billing component' },
        { path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' },
      ],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.chunks.some((chunk) => chunk.source_file.endsWith('.vue'))).toBe(true);
    expect(result.chunks.some((chunk) => chunk.source_file.endsWith('.tsx'))).toBe(true);
  });

  it('falls back to the base extension set when no stack pack is active', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-2',
    }).load(
      [
        { path: join(projectRoot, 'src/components/App.vue'), content: 'vue billing component' },
        { path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' },
      ],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.chunks.some((chunk) => chunk.source_file.endsWith('.vue'))).toBe(false);
    expect(result.chunks.some((chunk) => chunk.source_file.endsWith('.tsx'))).toBe(true);
  });

  it('records retrieval_depth in load stats', async () => {
    writeProjectProfile(projectRoot, baseProfile(['vue']));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-depth-1',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium', risk: 'low' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('standard');
  });

  it('uses standard depth when adaptive retrieval is disabled', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: true,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        adaptive_retrieval: { enabled: false, thresholds: { min_useful_chunks: 99 } },
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-depth-adaptive-off',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'high', scope: 'system-wide' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('standard');
    expect(result.stats.retrieval_escalated).toBeUndefined();
  });

  it('uses none depth for trivial single-file classification', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-depth-2',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'trivial', scope: 'single-file' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('none');
  });

  it('uses deep depth for high-complexity classification', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-depth-3',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'high' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('deep');
  });

  it('fusion_strategy is recorded in load stats', async () => {
    writeProjectProfile(projectRoot, baseProfile(['vue']));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-fusion-1',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.stats.fusion_strategy).toBeDefined();
    expect(result.stats.fusion_strategy?.signals).toContain('vector:0.55');
  });

  it('metadata filters extracted from affected_modules in classification', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));
    mkdirSync(join(projectRoot, 'src/billing'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/billing/Invoice.ts'),
      'export function invoiceBilling() { return "billing"; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/billing/Payments.ts'),
      'export function paymentsBilling() { return "billing"; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/billing/Refunds.ts'),
      'export function refundsBilling() { return "billing"; }\n',
    );

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-1',
    }).load(
      [
        { path: join(projectRoot, 'src/billing/Invoice.ts'), content: 'billing invoice component' },
        {
          path: join(projectRoot, 'src/billing/Payments.ts'),
          content: 'billing payments component',
        },
        { path: join(projectRoot, 'src/billing/Refunds.ts'), content: 'billing refunds component' },
        { path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' },
      ],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium', affected_modules: ['src/billing'] },
      },
    );

    // Fusion strategy should record the filter was applied
    expect(result.stats.fusion_strategy?.filters_applied).toContain('module_path_prefix');
  });

  it('extracts file extension filter from taskTargetFile', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));
    writeFileSync(
      join(projectRoot, 'src/components/BillingCard.tsx'),
      'export function BillingCard() { return <div>billing card</div>; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/BillingList.tsx'),
      'export function BillingList() { return <div>billing list</div>; }\n',
    );

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-ext',
    }).load(
      [
        { path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' },
        {
          path: join(projectRoot, 'src/components/BillingCard.tsx'),
          content: 'tsx billing card component',
        },
        {
          path: join(projectRoot, 'src/components/BillingList.tsx'),
          content: 'tsx billing list component',
        },
      ],
      {
        taskKeywords: ['billing'],
        taskTargetFile: join(projectRoot, 'src/components/App.tsx'),
        tokenBudget: 2000,
        symbolReferences: [],
      },
    );

    expect(result.stats.fusion_strategy?.filters_applied).toContain('file_extension');
  });

  it('extracts framework filter from stack profile when known', async () => {
    writeProjectProfile(projectRoot, baseProfile(['vue']));
    writeFileSync(
      join(projectRoot, 'src/components/BillingSummary.vue'),
      '<template><div>billing summary</div></template>\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/BillingTable.vue'),
      '<template><div>billing table</div></template>\n',
    );

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-framework',
    }).load(
      [
        { path: join(projectRoot, 'src/components/App.vue'), content: 'vue billing component' },
        {
          path: join(projectRoot, 'src/components/BillingSummary.vue'),
          content: 'vue billing summary component',
        },
        {
          path: join(projectRoot, 'src/components/BillingTable.vue'),
          content: 'vue billing table component',
        },
      ],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
      },
    );

    expect(result.stats.fusion_strategy?.filters_applied).toContain('framework');
  });

  it('extracts recency filter from classification when available', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));
    writeFileSync(
      join(projectRoot, 'src/components/BillingRecent.tsx'),
      'export function BillingRecent() { return <div>billing recent</div>; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/BillingRecentTwo.tsx'),
      'export function BillingRecentTwo() { return <div>billing recent two</div>; }\n',
    );

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-recency',
    }).load(
      [
        { path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' },
        {
          path: join(projectRoot, 'src/components/BillingRecent.tsx'),
          content: 'tsx billing recent component',
        },
        {
          path: join(projectRoot, 'src/components/BillingRecentTwo.tsx'),
          content: 'tsx billing recent two component',
        },
      ],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium', recency_cutoff_ms: 1000 },
      },
    );

    expect(result.stats.fusion_strategy?.filters_applied).toContain('recency_cutoff_ms');
  });

  it('applies recency filtering using chunk-index file mtimes', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));
    writeFileSync(
      join(projectRoot, 'src/components/Recent.tsx'),
      'export function Recent() { return <div>recent billing</div>; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/RecentTwo.tsx'),
      'export function RecentTwo() { return <div>recent billing two</div>; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/RecentThree.tsx'),
      'export function RecentThree() { return <div>recent billing three</div>; }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/components/Old.tsx'),
      'export function Old() { return <div>old billing</div>; }\n',
    );

    const oldTime = new Date(Date.now() - 86_400_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(join(projectRoot, 'src/components/Old.tsx'), oldTime, oldTime);

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-recency-real',
    }).load(
      [
        {
          path: join(projectRoot, 'src/components/Recent.tsx'),
          content: 'recent billing component',
        },
        {
          path: join(projectRoot, 'src/components/RecentTwo.tsx'),
          content: 'recent billing component two',
        },
        {
          path: join(projectRoot, 'src/components/RecentThree.tsx'),
          content: 'recent billing component three',
        },
        {
          path: join(projectRoot, 'src/components/Old.tsx'),
          content: 'old billing component',
        },
      ],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium', recency_cutoff_ms: 60_000 },
      },
    );

    expect(result.chunks.map((chunk) => chunk.source_file)).toContain(
      join(projectRoot, 'src/components/Recent.tsx'),
    );
    expect(result.chunks.map((chunk) => chunk.source_file)).not.toContain(
      join(projectRoot, 'src/components/Old.tsx'),
    );
  });

  it('keeps chunks with invalid chunk-index timestamps when recency filtering cannot evaluate them', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: true,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
    });

    vi.spyOn(ChunkIndexManager.prototype, 'sync').mockResolvedValueOnce({
      updated: false,
      changed_files: [],
      added_files: [],
      deleted_files: [],
      index: {
        version: 1,
        generated_at: new Date().toISOString(),
        entries: [
          {
            source_file: join(projectRoot, 'src/components/App.tsx'),
            content_hash: 'hash',
            modified_at: 'not-a-date',
            chunks: [
              {
                id: 'chunk-1',
                source_file: join(projectRoot, 'src/components/App.tsx'),
                ast_node_type: 'function',
                ast_node_path: 'App',
                exported_symbols: [],
                content: 'billing component',
                char_count: 16,
                content_hash: 'hash',
              },
            ],
          },
        ],
      },
    });
    vi.spyOn(RagService.prototype, 'retrieve').mockResolvedValueOnce({
      vector_scores: new Map([['chunk-1', 0.9]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['chunk-1'],
      retrieved_source_files: [join(projectRoot, 'src/components/App.tsx')],
      retrieved_chunks: [
        {
          id: 'chunk-1',
          source_file: join(projectRoot, 'src/components/App.tsx'),
          content: 'billing component',
        },
      ],
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-invalid-recency',
    }).load([{ path: join(projectRoot, 'src/components/App.tsx'), content: 'billing component' }], {
      taskKeywords: ['billing'],
      tokenBudget: 2000,
      symbolReferences: [],
      classification: { complexity: 'medium', recency_cutoff_ms: 1 },
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.source_file).toContain('App.tsx');
  });

  it('action_recommendations absent when action_routing disabled (default)', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-action-off',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.action_recommendations).toBeUndefined();
  });

  it('reranking stats absent when reranking disabled (default)', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-rerank-off',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.stats.reranking).toBeUndefined();
  });

  it('returns action recommendations when action routing is enabled and a workflow matches', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        action_routing: { enabled: true },
      },
    });
    mkdirSync(join(projectRoot, 'docs', 'instructions', 'workflows'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'docs', 'instructions', 'workflows', 'pentest.yaml'),
      'name: pentest\ndescription: pentest\nsteps: []\n',
    );

    writeFileSync(
      join(projectRoot, 'src/components/App.tsx'),
      'export function App() { return <div>security vulnerability pentest</div>; }\n',
    );
    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-action-on',
    }).load(
      [
        {
          path: join(projectRoot, 'src/components/App.tsx'),
          content: 'security vulnerability pentest',
        },
      ],
      {
        taskKeywords: ['security'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { risk: 'high' },
      },
    );

    expect(result.action_recommendations?.[0]?.workflow_id).toBe('pentest');
  });

  it('swallows load-stats persistence failures', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));
    const loader = new SemanticLoader({
      projectRoot,
      sessionId: 'session-persist-fail',
    });

    await loader.load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );
    rmSync(join(projectRoot, '.paqad', 'context', 'load-stats.json'), { force: true });
    mkdirSync(join(projectRoot, '.paqad', 'context', 'load-stats.json'));

    await expect(
      loader.load(
        [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
        { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
      ),
    ).resolves.toBeDefined();
  });

  it('bypasses semantic retrieval when full context override is set', async () => {
    writeProjectProfile(projectRoot, baseProfile(['vue']));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-3',
    }).load(
      [
        { path: join(projectRoot, 'src/components/App.vue'), content: 'vue billing component' },
        { path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' },
      ],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        fullContextOverride: true,
      },
    );

    expect(result.chunks).toHaveLength(2);
    expect(result.stats.tokens_before).toBeGreaterThan(0);
    expect(result.stats.tokens_after).toBe(result.stats.tokens_before);
    expect(result.stats.reduction_pct).toBe(0);
    expect(result.stats.chunks_loaded).toBe(2);

    const stats = JSON.parse(
      readFileSync(join(projectRoot, '.paqad', 'context', 'load-stats.json'), 'utf8'),
    ) as { session_id: string; reduction_pct: number };
    expect(stats).toMatchObject({
      session_id: 'session-3',
      reduction_pct: 0,
    });
  });

  it('reports zero reduction when semantic loading starts with no inline artifact content', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-zero-before',
    }).load([{ path: join(projectRoot, 'src/components/App.tsx') }], {
      taskKeywords: ['billing'],
      tokenBudget: 2000,
      symbolReferences: [],
    });

    expect(result.stats.tokens_before).toBe(0);
    expect(result.stats.reduction_pct).toBe(0);
  });

  it('uses empty string content when full-context override artifact content is missing', async () => {
    writeProjectProfile(projectRoot, baseProfile(undefined));

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-override-empty',
    }).load([{ path: join(projectRoot, 'src/components/App.tsx') }], {
      taskKeywords: ['billing'],
      tokenBudget: 2000,
      symbolReferences: [],
      fullContextOverride: true,
    });

    expect(result.chunks[0]?.content).toBe('');
    expect(result.stats.reduction_pct).toBe(0);
  });

  it('records reranking stats when reranking is enabled with passthrough backend', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        reranking: { enabled: true, backend: 'passthrough', candidate_pool_size: 5 },
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-rerank-on',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.stats.reranking).toMatchObject({
      enabled: true,
      backend: 'passthrough',
      candidate_pool_size: 5,
    });
  });

  it('defaults reranking candidate_pool_size to 50 when omitted', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        reranking: { enabled: true, backend: 'passthrough' },
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-rerank-default-size',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.stats.reranking).toMatchObject({
      enabled: true,
      candidate_pool_size: 50,
    });
  });

  it('re-scores against escalated retrieved chunks when the second-stage retrieval returns ids', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: true,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        adaptive_retrieval: { enabled: true, thresholds: { min_useful_chunks: 99 } },
      },
    });

    vi.spyOn(RagService.prototype, 'retrieve')
      .mockResolvedValueOnce({
        vector_scores: new Map(),
        chunks_retrieved: 0,
        retrieved_chunk_ids: [],
        retrieved_source_files: [],
        retrieved_chunks: [],
      })
      .mockResolvedValueOnce({
        vector_scores: new Map([['escalated', 0.95]]),
        chunks_retrieved: 1,
        retrieved_chunk_ids: ['escalated'],
        retrieved_source_files: [join(projectRoot, 'src/components/Escalated.tsx')],
        retrieved_chunks: [
          {
            id: 'escalated',
            source_file: join(projectRoot, 'src/components/Escalated.tsx'),
            content: 'escalated billing context',
          },
        ],
      });
    vi.spyOn(ChunkIndexManager.prototype, 'sync').mockResolvedValueOnce({
      updated: false,
      changed_files: [],
      added_files: [],
      deleted_files: [],
      index: {
        version: 1,
        generated_at: new Date().toISOString(),
        entries: [
          {
            source_file: join(projectRoot, 'src/components/Escalated.tsx'),
            content_hash: 'hash-escalated',
            modified_at: new Date().toISOString(),
            chunks: [
              {
                id: 'escalated',
                source_file: join(projectRoot, 'src/components/Escalated.tsx'),
                ast_node_type: 'function',
                ast_node_path: 'Escalated',
                exported_symbols: [],
                content: 'escalated billing context',
                char_count: 24,
                content_hash: 'hash-escalated',
              },
            ],
          },
          {
            source_file: join(projectRoot, 'src/components/Irrelevant.tsx'),
            content_hash: 'hash-irrelevant',
            modified_at: new Date().toISOString(),
            chunks: [
              {
                id: 'irrelevant',
                source_file: join(projectRoot, 'src/components/Irrelevant.tsx'),
                ast_node_type: 'function',
                ast_node_path: 'Irrelevant',
                exported_symbols: [],
                content: 'unrelated data',
                char_count: 13,
                content_hash: 'hash-irrelevant',
              },
            ],
          },
        ],
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-escalated-bounded',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium' },
      },
    );

    expect(result.stats.retrieval_escalated).toBe(true);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['escalated']);
  });

  it('ignores stack packs without AST extension metadata', async () => {
    vi.spyOn(projectPacks, 'getPacksForFrameworks').mockReturnValueOnce([
      { manifest: {} } as FrameworkPack,
    ]);

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-pack-no-ast',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      { taskKeywords: ['billing'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.chunks.some((chunk) => chunk.source_file.endsWith('.tsx'))).toBe(true);
  });

  it('escalates retrieval depth once when ranked evidence is below the useful threshold', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: true,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        adaptive_retrieval: { enabled: true, thresholds: { min_useful_chunks: 99 } },
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-escalated',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('deep');
    expect(result.stats.retrieval_escalated).toBe(true);
  });

  it('returns no action recommendations when routing is enabled but nothing matches', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        action_routing: { enabled: true },
      },
    });
    mkdirSync(join(projectRoot, 'docs', 'instructions', 'workflows'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'docs', 'instructions', 'workflows', 'pentest.yaml'),
      'name: pentest\ndescription: pentest\nsteps: []\n',
    );

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-action-empty',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'plain billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
      },
    );

    expect(result.action_recommendations).toBeUndefined();
  });

  it('returns no action recommendations when routing is enabled but no workflows are registered', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        action_routing: { enabled: true },
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-action-no-registry',
    }).load(
      [
        {
          path: join(projectRoot, 'src/components/App.tsx'),
          content: 'security vulnerability pentest',
        },
      ],
      {
        taskKeywords: ['security'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { risk: 'high' },
      },
    );

    expect(result.action_recommendations).toBeUndefined();
  });

  it('skips metadata filter extraction when metadata filters are disabled', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(['vue']),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
        metadata_filters: { enabled: false },
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-filter-disabled',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.vue'), content: 'vue billing component' }],
      {
        taskKeywords: ['billing'],
        taskTargetFile: join(projectRoot, 'src/components/App.vue'),
        tokenBudget: 2000,
        symbolReferences: [],
        classification: {
          affected_modules: ['src/components'],
          frameworks: ['vue'],
          recency_cutoff_ms: 1000,
        },
      },
    );

    expect(result.stats.fusion_strategy?.filters_applied).toEqual([]);
  });

  it('enforces critical, task-relevant, and supporting budget buckets during packing', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(['vue']),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
    });

    const lowChunk = {
      id: 'low',
      source_file: join(projectRoot, 'notes/misc.ts'),
      ast_node_type: 'fallback' as const,
      ast_node_path: 'notes/misc.ts',
      exported_symbols: [],
      content: 'l'.repeat(24),
      char_count: 24,
      content_hash: 'low',
    };
    const criticalChunk = {
      id: 'critical',
      source_file: join(projectRoot, 'docs/instructions/rules/testing.md'),
      ast_node_type: 'fallback' as const,
      ast_node_path: 'docs/instructions/rules/testing.md',
      exported_symbols: [],
      content: 'c'.repeat(24),
      char_count: 24,
      content_hash: 'critical',
    };
    const taskChunk = {
      id: 'task',
      source_file: join(projectRoot, 'src/components/App.tsx'),
      ast_node_type: 'fallback' as const,
      ast_node_path: 'src/components/App.tsx',
      exported_symbols: [],
      content: 't'.repeat(24),
      char_count: 24,
      content_hash: 'task',
    };

    vi.spyOn(ChunkIndexManager.prototype, 'sync').mockResolvedValueOnce({
      updated: false,
      changed_files: [],
      added_files: [],
      removed_files: [],
      index: {
        version: 1,
        generated_at: new Date().toISOString(),
        entries: [
          {
            source_file: lowChunk.source_file,
            source_file_hash: 'low',
            modified_at: new Date().toISOString(),
            chunks: [lowChunk],
          },
          {
            source_file: criticalChunk.source_file,
            source_file_hash: 'critical',
            modified_at: new Date().toISOString(),
            chunks: [criticalChunk],
          },
          {
            source_file: taskChunk.source_file,
            source_file_hash: 'task',
            modified_at: new Date().toISOString(),
            chunks: [taskChunk],
          },
        ],
      },
    });
    vi.spyOn(RagService.prototype, 'retrieve').mockResolvedValueOnce({
      vector_scores: new Map(),
      chunks_retrieved: 0,
      retrieved_chunk_ids: [],
      retrieved_source_files: [],
      retrieved_chunks: [],
      fallback_reason: undefined,
    });
    vi.spyOn(RelevanceScorer.prototype, 'filterAndRank').mockReturnValueOnce({
      chunks: [lowChunk, criticalChunk, taskChunk],
      fusion_strategy: {
        signals: [],
        filters_applied: [],
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-budget-buckets',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        taskTargetFile: join(projectRoot, 'src/components/App.tsx'),
        tokenBudget: 20,
        symbolReferences: [],
      },
    );

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['critical', 'task', 'low']);
  });

  it('passes trivial complexity hints to the budget allocator, reducing supporting budget', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
    });

    const { BudgetAllocator } = await import('@/context/budget-allocator.js');
    const allocateSpy = vi.spyOn(BudgetAllocator.prototype, 'allocate');

    await new SemanticLoader({
      projectRoot,
      sessionId: 'session-trivial-hints',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 1000,
        symbolReferences: [],
        classification: { complexity: 'trivial', scope: 'single-file' },
      },
    );

    expect(allocateSpy).toHaveBeenCalledWith(1000, {
      complexity: 'trivial',
      scope: 'single-file',
    });
    const result = allocateSpy.mock.results[0]?.value as {
      critical_budget: number;
      supporting_budget: number;
    };
    // trivial preset: critical=55%, supporting=5%
    expect(result.critical_budget).toBe(550);
    expect(result.supporting_budget).toBe(50);

    allocateSpy.mockRestore();
  });

  it('passes system-wide scope hints to the budget allocator, increasing supporting budget', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
    });

    const { BudgetAllocator } = await import('@/context/budget-allocator.js');
    const allocateSpy = vi.spyOn(BudgetAllocator.prototype, 'allocate');

    await new SemanticLoader({
      projectRoot,
      sessionId: 'session-system-wide-hints',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 1000,
        symbolReferences: [],
        classification: { complexity: 'very-high', scope: 'system-wide' },
      },
    );

    expect(allocateSpy).toHaveBeenCalledWith(1000, {
      complexity: 'very-high',
      scope: 'system-wide',
    });
    const result = allocateSpy.mock.results[0]?.value as {
      critical_budget: number;
      supporting_budget: number;
    };
    // very-high/system-wide preset: critical=35%, supporting=25%
    expect(result.critical_budget).toBe(350);
    expect(result.supporting_budget).toBe(250);

    allocateSpy.mockRestore();
  });

  it('passes undefined hints when no classification is provided', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
    });

    const { BudgetAllocator } = await import('@/context/budget-allocator.js');
    const allocateSpy = vi.spyOn(BudgetAllocator.prototype, 'allocate');

    await new SemanticLoader({
      projectRoot,
      sessionId: 'session-no-classification',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 1000,
        symbolReferences: [],
      },
    );

    expect(allocateSpy).toHaveBeenCalledWith(1000, {
      complexity: undefined,
      scope: undefined,
    });
    const result = allocateSpy.mock.results[0]?.value as {
      critical_budget: number;
      task_relevant_budget: number;
      supporting_budget: number;
    };
    // default ratios: 40/45/15
    expect(result.critical_budget).toBe(400);
    expect(result.task_relevant_budget).toBe(450);
    expect(result.supporting_budget).toBe(150);

    allocateSpy.mockRestore();
  });

  it('deduplicates repeated semantic chunks before spending the token budget', async () => {
    writeProjectProfile(projectRoot, {
      ...baseProfile(undefined),
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
    });

    const duplicateOne = {
      id: 'dup-1',
      source_file: join(projectRoot, 'src/components/One.tsx'),
      ast_node_type: 'function' as const,
      ast_node_path: 'One',
      exported_symbols: [],
      content: 'shared billing logic',
      char_count: 18,
      content_hash: 'shared-hash',
    };
    const duplicateTwo = {
      ...duplicateOne,
      id: 'dup-2',
      source_file: join(projectRoot, 'src/components/Two.tsx'),
    };
    const uniqueChunk = {
      id: 'unique',
      source_file: join(projectRoot, 'src/components/Three.tsx'),
      ast_node_type: 'function' as const,
      ast_node_path: 'Three',
      exported_symbols: [],
      content: 'unique billing evidence',
      char_count: 21,
      content_hash: 'unique-hash',
    };

    vi.spyOn(ChunkIndexManager.prototype, 'sync').mockResolvedValueOnce({
      updated: false,
      changed_files: [],
      added_files: [],
      removed_files: [],
      index: {
        version: 1,
        generated_at: new Date().toISOString(),
        entries: [
          {
            source_file: duplicateOne.source_file,
            source_file_hash: 'one',
            modified_at: new Date().toISOString(),
            chunks: [duplicateOne],
          },
          {
            source_file: duplicateTwo.source_file,
            source_file_hash: 'two',
            modified_at: new Date().toISOString(),
            chunks: [duplicateTwo],
          },
          {
            source_file: uniqueChunk.source_file,
            source_file_hash: 'three',
            modified_at: new Date().toISOString(),
            chunks: [uniqueChunk],
          },
        ],
      },
    });
    vi.spyOn(RagService.prototype, 'retrieve').mockResolvedValueOnce({
      vector_scores: new Map(),
      chunks_retrieved: 0,
      retrieved_chunk_ids: [],
      retrieved_source_files: [],
      retrieved_chunks: [],
      fallback_reason: undefined,
    });
    vi.spyOn(RelevanceScorer.prototype, 'filterAndRank').mockReturnValueOnce({
      chunks: [duplicateOne, duplicateTwo, uniqueChunk],
      fusion_strategy: {
        signals: [],
        filters_applied: [],
      },
    });

    const result = await new SemanticLoader({
      projectRoot,
      sessionId: 'session-dedup-chunks',
    }).load(
      [{ path: join(projectRoot, 'src/components/App.tsx'), content: 'tsx billing component' }],
      {
        taskKeywords: ['billing'],
        tokenBudget: 40,
        symbolReferences: [],
      },
    );

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['dup-1', 'unique']);
  });
});

function baseProfile(frameworks?: string[]) {
  return {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: frameworks
      ? (['content', 'coding', 'security'] as const)
      : (['content'] as const),
    stack_profile: frameworks
      ? {
          frameworks,
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        }
      : undefined,
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
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: { depth: 'standard' },
    efficiency: { differential_refresh: true },
    escalation: {
      destructive_operations: 'block',
      risky_migrations: 'warn',
      security_findings: 'block',
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}
