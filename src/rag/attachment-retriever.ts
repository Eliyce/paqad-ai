// PQD-174 — retrieval over a session's ephemeral attachment collection.
//
// Called before an assistant turn to fetch grounding chunks from the files the
// user attached to this session. Retrieval reads only the session's own
// collection, so chunks can never cross over from another session. The query is
// embedded with the same provider/model the collection was built with (read
// from its stored meta) so the vectors are comparable.

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

/**
 * Retrieve the top-N attachment chunks for `query` from a session's collection.
 * Returns an empty result with `fallback_reason: 'no-attachment-collection'`
 * when the session has no registered collection.
 */
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
    // Registered but the index/meta is gone (e.g. removed out of band).
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
