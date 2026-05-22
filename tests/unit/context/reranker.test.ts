import { vi } from 'vitest';
import {
  PassthroughReranker,
  LocalReranker,
  CohereReranker,
  createReranker,
} from '@/context/reranker.js';
import type { Chunk } from '@/context/types.js';

function makeChunk(id: string, content: string): Chunk {
  return {
    id,
    source_file: `src/${id}.ts`,
    ast_node_type: 'function',
    ast_node_path: id,
    exported_symbols: [],
    content,
    char_count: content.length,
    content_hash: id,
  };
}

const CHUNKS = [
  makeChunk('auth', 'export function canAuth() {}'),
  makeChunk('billing', 'export function runBilling() {}'),
  makeChunk('session', 'export function getSession() {}'),
];

describe('PassthroughReranker', () => {
  it('preserves input order', async () => {
    const reranker = new PassthroughReranker();
    const result = await reranker.rerank('auth', CHUNKS);
    expect(result.chunks.map((c) => c.id)).toEqual(['auth', 'billing', 'session']);
    expect(result.pre_rerank_ids).toEqual(result.post_rerank_ids);
    expect(result.latency_ms).toBe(0);
  });

  it('respects candidatePoolSize', async () => {
    const reranker = new PassthroughReranker();
    const result = await reranker.rerank('auth', CHUNKS, 2);
    expect(result.chunks).toHaveLength(2);
    expect(result.pre_rerank_ids).toHaveLength(2);
  });

  it('has correct backend and model identifiers', () => {
    const reranker = new PassthroughReranker();
    expect(reranker.backend).toBe('passthrough');
    expect(reranker.model).toBe('none');
  });
});

describe('LocalReranker', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scores chunks and reorders them by descending score', async () => {
    // Stub @xenova/transformers so that 'auth' chunk gets higher score
    vi.doMock('@xenova/transformers', () => ({
      pipeline: async (task: string, model: string) => {
        void task;
        void model;
        return async (input: { text: string; text_pair: string }) => {
          // Give auth a high score, others low
          const score = input.text_pair.includes('canAuth') ? 0.9 : 0.1;
          return { score, label: 'LABEL_1' };
        };
      },
    }));

    const { LocalReranker: LR } = await import('@/context/reranker.js');
    const reranker = new LR();
    const result = await reranker.rerank('auth', CHUNKS);

    expect(result.chunks[0]?.id).toBe('auth');
    expect(result.pre_rerank_ids).toEqual(['auth', 'billing', 'session']);
    expect(result.post_rerank_ids[0]).toBe('auth');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('bounded by candidatePoolSize', async () => {
    vi.doMock('@xenova/transformers', () => ({
      pipeline: async () => async () => ({ score: 0.5, label: 'LABEL_1' }),
    }));

    const { LocalReranker: LR } = await import('@/context/reranker.js');
    const reranker = new LR();
    const result = await reranker.rerank('query', CHUNKS, 2);

    expect(result.chunks).toHaveLength(2);
    expect(result.pre_rerank_ids).toHaveLength(2);
  });

  it('handles array result from pipeline', async () => {
    vi.doMock('@xenova/transformers', () => ({
      pipeline: async () => async (input: { text: string; text_pair: string }) => {
        const score = input.text_pair.includes('canAuth') ? 0.8 : 0.2;
        return [{ score, label: 'LABEL_1' }];
      },
    }));

    const { LocalReranker: LR } = await import('@/context/reranker.js');
    const reranker = new LR();
    const result = await reranker.rerank('auth', CHUNKS);

    expect(result.chunks[0]?.id).toBe('auth');
  });

  it('has backend=local identifier', () => {
    const reranker = new LocalReranker();
    expect(reranker.backend).toBe('local');
    expect(reranker.model).toBe('Xenova/ms-marco-MiniLM-L-6-v2');
  });

  it('accepts custom model', () => {
    const reranker = new LocalReranker('custom/model');
    expect(reranker.model).toBe('custom/model');
  });
});

describe('CohereReranker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls Cohere API and reorders chunks by result index', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 },
          { index: 1, relevance_score: 0.3 },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const reranker = new CohereReranker('rerank-english-v3.0', 'test-api-key');
    const result = await reranker.rerank('auth', CHUNKS);

    expect(result.chunks.map((c) => c.id)).toEqual(['session', 'auth', 'billing']);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cohere.com/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    );
  });

  it('throws on API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }),
    );

    const reranker = new CohereReranker();
    await expect(reranker.rerank('auth', CHUNKS)).rejects.toThrow('Cohere rerank failed');
  });

  it('bounded by candidatePoolSize', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.5 },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const reranker = new CohereReranker();
    const result = await reranker.rerank('auth', CHUNKS, 2);

    expect(result.chunks).toHaveLength(2);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as { documents: string[] };
    expect(body.documents).toHaveLength(2);
  });

  it('has backend=cohere identifier', () => {
    const reranker = new CohereReranker();
    expect(reranker.backend).toBe('cohere');
  });
});

describe('createReranker factory', () => {
  it('returns PassthroughReranker when enabled=false', () => {
    const r = createReranker({ enabled: false, backend: 'local' });
    expect(r.backend).toBe('passthrough');
  });

  it('returns PassthroughReranker when config is undefined', () => {
    const r = createReranker(undefined);
    expect(r.backend).toBe('passthrough');
  });

  it('returns LocalReranker when enabled=true backend=local', () => {
    const r = createReranker({ enabled: true, backend: 'local' });
    expect(r.backend).toBe('local');
  });

  it('returns CohereReranker when enabled=true backend=cohere', () => {
    const r = createReranker({ enabled: true, backend: 'cohere', api_key: 'key' });
    expect(r.backend).toBe('cohere');
  });

  it('returns PassthroughReranker for passthrough backend', () => {
    const r = createReranker({ enabled: true, backend: 'passthrough' });
    expect(r.backend).toBe('passthrough');
  });
});
