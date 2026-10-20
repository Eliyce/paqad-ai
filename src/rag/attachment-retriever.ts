import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';

import { collectionVectorPaths, getCollectionId } from './attachment-registry.js';
import { createEmbeddingProvider } from './providers.js';
import type { ProviderFactory, RagRetrievalResult, StoredVectorChunk } from './types.js';
import { FileVectorIndex } from './vector-index.js';

function emptyResult(fallbackReason: string): RagRetrievalResult {
  return {
    vector_scores: new Map(),
    chunks_retrieved: 0,
    retrieved_chunk_ids: [],
    retrieved_source_files: [],
    retrieved_chunks: [],
    fallback_reason: fallbackReason,
  };
}

export async function retrieveFromAttachments(
  projectRoot: string,
  sessionId: string,
  query: string,
  topN?: number,
  providerFactory: ProviderFactory = createEmbeddingProvider,
): Promise<RagRetrievalResult> {
  const collectionId = await getCollectionId(projectRoot, sessionId);
  if (!collectionId) {
    return emptyResult('no-attachment-collection');
  }

  const { indexPath, metaPath } = collectionVectorPaths(projectRoot, sessionId);
  const index = new FileVectorIndex<StoredVectorChunk>(indexPath, metaPath);
  const meta = await index.loadMeta(projectRoot);
  if (!meta) {
    return emptyResult('attachment-index-unavailable');
  }

  const intelligence = normalizeIntelligenceConfig({
    rag_enabled: true,
    embedding_provider: meta.provider,
    embedding_model: meta.model,
  });
  const limit = topN ?? intelligence.rag_top_n;

  const provider = await providerFactory(projectRoot, intelligence);
  const [queryVector] = await provider.embed(query);
  const results = await index.query(projectRoot, queryVector, limit);

  return {
    vector_scores: new Map(results.map((result) => [result.item.id, result.score])),
    chunks_retrieved: results.length,
    retrieved_chunk_ids: results.map((result) => result.item.id),
    retrieved_source_files: results.map((result) => result.item.source_file),
    retrieved_chunks: results.map((result) => ({
      id: result.item.id,
      source_file: result.item.source_file,
      content: result.item.content,
    })),
  };
}
