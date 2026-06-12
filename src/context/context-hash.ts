import { createHash } from 'node:crypto';

import type { ClassificationResult } from '../core/types/classification.js';
import type { DisplayMessage } from '../core/types/conversation.js';

// Issue #123 — promote paqad's deterministic context rebuild into a persisted,
// versioned reproducibility stamp: a SHA-256 over the EXACT frozen materials an
// agent saw, asserting "this change is replayable from this context".
//
// This supersedes the ephemeral `rebuild-cache.ts:computeKey` for durable use.
// computeKey is fine as an in-process cache key (a raw JSON.stringify is OK when
// it never outlives the process), but a durable commitment needs a pinned,
// canonical, explicitly-versioned preimage — key-order drift or an added input
// must be a deliberate algoVersion bump, never a silent hash change.
//
// HONESTY: this proves input-replayability, NOT bit-identical LLM regeneration.
// A hosted model exposes no stable seed and is non-deterministic even at
// temperature 0 (batched float accumulation, MoE routing). The stamp therefore
// records `determinism: 'input-replay'` and never implies exact regeneration.

/** Bumped whenever the preimage shape/serialization changes incompatibly, so a
 *  stored hash can be matched against the algorithm that produced it. */
export const CONTEXT_HASH_ALGO_VERSION = 1 as const;

/** The materials folded into the hash. Mirrors the rebuild inputs plus the
 *  facts that change the produced context (summariser mode, truncation). */
export interface ContextHashInput {
  /** The resolved active-branch lineage (chronological), from resolveActiveLineage. */
  lineage: readonly DisplayMessage[];
  classifierOutput: Pick<ClassificationResult, 'retrieval_needed' | 'context_budget_hint'>;
  /** Retrieved chunks folded in — hashed by id + content digest, not raw text. */
  retrievedChunks: readonly { chunkId: string; content: string }[];
  budgetTokens: number;
  /** Identifies the summariser that produced any collapsed turns. The LLM-backed
   *  path is non-deterministic, so its mode must be distinguishable in the hash. */
  summarizerMode: string;
  truncated: boolean;
  truncatedTurnCount: number;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Deterministic JSON serialization: object keys sorted recursively, array order
 * preserved (lineage order is meaningful). The only correct way to hash a
 * durable commitment — `JSON.stringify` alone leaks key-insertion order.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
    );
  return `{${entries.join(',')}}`;
}

/** Build the canonical, versioned preimage object. Exported for tests so the
 *  exact materials covered by the hash are inspectable. */
export function buildContextHashPreimage(input: ContextHashInput): Record<string, unknown> {
  return {
    algo_version: CONTEXT_HASH_ALGO_VERSION,
    lineage: input.lineage.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.createdAt,
    })),
    classifier: {
      retrieval_needed: input.classifierOutput.retrieval_needed === true,
      context_budget_hint: input.classifierOutput.context_budget_hint ?? null,
    },
    // Chunk content is hashed (mirrors ast-chunker's sha256-of-content pattern),
    // so the preimage commits to the chunk bytes without inlining them.
    retrieved_chunks: input.retrievedChunks.map((chunk) => ({
      chunk_id: chunk.chunkId,
      content_sha256: sha256Hex(chunk.content),
    })),
    budget_tokens: input.budgetTokens,
    summarizer_mode: input.summarizerMode,
    truncated: input.truncated,
    truncated_turn_count: input.truncatedTurnCount,
  };
}

/**
 * The reproducibility context hash: SHA-256 over the canonical, versioned
 * preimage. Same materials always yield the same hash; any change to lineage,
 * classifier output, retrieved chunk content, budget, summariser mode, or
 * truncation flips it. Key-order independent by construction.
 */
export function computeContextHash(input: ContextHashInput): string {
  return sha256Hex(canonicalize(buildContextHashPreimage(input)));
}
