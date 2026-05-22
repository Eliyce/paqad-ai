import type { Chunk } from './types.js';

export interface RerankResult {
  chunks: Chunk[];
  pre_rerank_ids: string[];
  post_rerank_ids: string[];
  latency_ms: number;
}

export interface Reranker {
  readonly backend: string;
  readonly model: string;
  rerank(query: string, chunks: Chunk[], candidatePoolSize?: number): Promise<RerankResult>;
}

export interface RerankingConfig {
  enabled: boolean;
  backend: 'local' | 'cohere' | 'passthrough';
  model?: string;
  candidate_pool_size?: number;
  api_key?: string;
}

// ─── PassthroughReranker ─────────────────────────────────────────────────────

export class PassthroughReranker implements Reranker {
  readonly backend = 'passthrough';
  readonly model = 'none';

  async rerank(_query: string, chunks: Chunk[], candidatePoolSize = 50): Promise<RerankResult> {
    const pool = chunks.slice(0, candidatePoolSize);
    const ids = pool.map((c) => c.id);
    return {
      chunks: pool,
      pre_rerank_ids: ids,
      post_rerank_ids: ids,
      latency_ms: 0,
    };
  }
}

// ─── LocalReranker ────────────────────────────────────────────────────────────

type CrossEncoderPipeline = (
  input: { text: string; text_pair: string } | { text: string; text_pair: string }[],
) => Promise<{ score: number; label: string } | { score: number; label: string }[]>;

export class LocalReranker implements Reranker {
  readonly backend = 'local';
  readonly model: string;
  private pipelinePromise?: Promise<CrossEncoderPipeline>;

  constructor(model = 'Xenova/ms-marco-MiniLM-L-6-v2') {
    this.model = model;
  }

  private getPipeline(): Promise<CrossEncoderPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = this.loadPipeline();
    }
    return this.pipelinePromise;
  }

  private async loadPipeline(): Promise<CrossEncoderPipeline> {
    const { pipeline } = (await import('@xenova/transformers')) as {
      pipeline: (task: string, model: string) => Promise<CrossEncoderPipeline>;
    };
    return pipeline('text-classification', this.model);
  }

  async rerank(query: string, chunks: Chunk[], candidatePoolSize = 50): Promise<RerankResult> {
    const pool = chunks.slice(0, candidatePoolSize);
    const preIds = pool.map((c) => c.id);
    const start = Date.now();

    const classifier = await this.getPipeline();

    const scored = await Promise.all(
      pool.map(async (chunk) => {
        const result = await classifier({ text: query, text_pair: chunk.content });
        const item = Array.isArray(result) ? result[0] : result;
        return { chunk, score: item?.score ?? 0 };
      }),
    );

    scored.sort((a, b) => b.score - a.score);
    const reranked = scored.map((s) => s.chunk);

    return {
      chunks: reranked,
      pre_rerank_ids: preIds,
      post_rerank_ids: reranked.map((c) => c.id),
      latency_ms: Date.now() - start,
    };
  }
}

// ─── CohereReranker ───────────────────────────────────────────────────────────

interface CohereRerankResult {
  results: { index: number; relevance_score: number }[];
}

export class CohereReranker implements Reranker {
  readonly backend = 'cohere';
  readonly model: string;
  private readonly apiKey: string;

  constructor(model = 'rerank-english-v3.0', apiKey = '') {
    this.model = model;
    this.apiKey = apiKey;
  }

  async rerank(query: string, chunks: Chunk[], candidatePoolSize = 50): Promise<RerankResult> {
    const pool = chunks.slice(0, candidatePoolSize);
    const preIds = pool.map((c) => c.id);
    const start = Date.now();

    const response = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: pool.map((c) => c.content),
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere rerank failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as CohereRerankResult;
    const reranked = data.results.map((r) => pool[r.index]!);

    return {
      chunks: reranked,
      pre_rerank_ids: preIds,
      post_rerank_ids: reranked.map((c) => c.id),
      latency_ms: Date.now() - start,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createReranker(config?: RerankingConfig): Reranker {
  if (!config?.enabled) {
    return new PassthroughReranker();
  }
  switch (config.backend) {
    case 'local':
      return new LocalReranker(config.model);
    case 'cohere':
      return new CohereReranker(config.model, config.api_key ?? '');
    default:
      return new PassthroughReranker();
  }
}
