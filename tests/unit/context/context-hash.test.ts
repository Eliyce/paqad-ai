import {
  CONTEXT_HASH_ALGO_VERSION,
  buildContextHashPreimage,
  computeContextHash,
  type ContextHashInput,
} from '@/context/context-hash.js';
import type { DisplayMessage } from '@/core/types/conversation.js';

const lineage: DisplayMessage[] = [
  { id: 'a', role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'b', role: 'assistant', content: 'hi', createdAt: '2026-01-01T00:00:01Z' },
];

function base(): ContextHashInput {
  return {
    lineage,
    classifierOutput: { retrieval_needed: false, context_budget_hint: 'low' },
    retrievedChunks: [],
    budgetTokens: 8000,
    summarizerMode: 'deterministic-regex',
    truncated: false,
    truncatedTurnCount: 0,
  };
}

describe('computeContextHash', () => {
  it('is deterministic for identical inputs', () => {
    expect(computeContextHash(base())).toBe(computeContextHash(base()));
  });

  it('is independent of object key order in the input', () => {
    const reordered: ContextHashInput = {
      truncatedTurnCount: 0,
      truncated: false,
      summarizerMode: 'deterministic-regex',
      budgetTokens: 8000,
      retrievedChunks: [],
      classifierOutput: { context_budget_hint: 'low', retrieval_needed: false },
      lineage,
    };
    expect(computeContextHash(reordered)).toBe(computeContextHash(base()));
  });

  it('flips when any material changes', () => {
    const original = computeContextHash(base());
    expect(computeContextHash({ ...base(), budgetTokens: 9000 })).not.toBe(original);
    expect(computeContextHash({ ...base(), summarizerMode: 'optimizer' })).not.toBe(original);
    expect(computeContextHash({ ...base(), truncated: true })).not.toBe(original);
    expect(
      computeContextHash({
        ...base(),
        lineage: [
          ...lineage,
          { id: 'c', role: 'user', content: 'more', createdAt: '2026-01-01T00:00:02Z' },
        ],
      }),
    ).not.toBe(original);
  });

  it('hashes retrieved chunk content (different content -> different hash)', () => {
    const withChunkA = computeContextHash({
      ...base(),
      retrievedChunks: [{ chunkId: 'c1', content: 'alpha' }],
    });
    const withChunkB = computeContextHash({
      ...base(),
      retrievedChunks: [{ chunkId: 'c1', content: 'beta' }],
    });
    expect(withChunkA).not.toBe(withChunkB);
  });

  it('does not inline raw chunk content in the preimage', () => {
    const preimage = buildContextHashPreimage({
      ...base(),
      retrievedChunks: [{ chunkId: 'c1', content: 'secret-text' }],
    });
    expect(JSON.stringify(preimage)).not.toContain('secret-text');
  });

  it('includes the algo version in the preimage', () => {
    expect(buildContextHashPreimage(base()).algo_version).toBe(CONTEXT_HASH_ALGO_VERSION);
  });
});
