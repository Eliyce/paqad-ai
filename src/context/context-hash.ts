import { createHash } from 'node:crypto';

import type { ClassificationResult } from '../core/types/classification.js';
import type { DisplayMessage } from '../core/types/conversation.js';

export const CONTEXT_HASH_ALGO_VERSION = 1 as const;

export interface ContextHashInput {
  lineage: readonly DisplayMessage[];
  classifierOutput: Pick<ClassificationResult, 'retrieval_needed' | 'context_budget_hint'>;
  retrievedChunks: readonly { chunkId: string; content: string }[];
  budgetTokens: number;
  summarizerMode: string;
  truncated: boolean;
  truncatedTurnCount: number;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

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

export function computeContextHash(input: ContextHashInput): string {
  return sha256Hex(canonicalize(buildContextHashPreimage(input)));
}
